import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	COMMAND_GROUPS,
	HELP_WORDS,
	run,
	TOP_LEVEL_COMMANDS,
	VERSION_WORDS,
} from "./index.js";

// The gap #902's command table left open (#953): the table decides what is
// *listed*, but a hand-written branch inside `dispatch` (or any helper it
// calls) can still make a word dispatch without appearing in any listing —
// "callable but absent from --help".
//
// What this suite closes is one path to that defect, not the defect class:
// **a branch keyed on a word some candidate generator below produces.** A
// behavioural probe can only try words it can think of, so a branch keyed on
// a word no generator yields — one built at runtime, or read from the
// environment — dispatches unseen. Naming the path rather than the class
// matters because the alternative mechanism (a lint over the dispatcher's
// source) closes a *different* path, and neither subsumes the other: the lint
// misses branch forms it did not enumerate, and this probe misses words it did
// not generate. See the two generators for what each one covers.

const SOURCE = readFileSync(resolve(__dirname, "index.ts"), "utf-8");

/** The words the tables and the fixed pre-table words make legitimate at the top level. */
const KNOWN_TOP_LEVEL = new Set([
	...TOP_LEVEL_COMMANDS.map((c) => c.name),
	...COMMAND_GROUPS.map((g) => g.name),
	// Derived, not restated: `--version`/`-V`/`--help`/`-h` are filtered out by
	// the candidate shape below, but deriving the set means a fixed word added
	// to index.ts cannot leave a stale copy here.
	...VERSION_WORDS,
	...HELP_WORDS,
]);

/**
 * Double-quoted literals in the CLI source that could stand as a command word.
 * Over-collects on purpose — field names, statuses and format names ride along
 * — because the job is to try words the tables do *not* know. Covers a branch
 * that compares against a double-quoted literal written in this file.
 */
function literalCandidates(): string[] {
	const words = new Set<string>();
	for (const [, literal = ""] of SOURCE.matchAll(/"([^"\\\n]{1,40})"/g)) {
		if (/^[a-z][a-z0-9-]*$/.test(literal)) words.add(literal);
	}
	return [...words];
}

/**
 * Words built by extending a name the CLI already knows. Covers the branch
 * form that introduces no literal of its own — `command.startsWith("graph")`
 * reuses a word the tables contain, so every literal in the source is either
 * a legitimate command or fails to reach it, and literal scraping alone
 * reports green while `pfdsl graphs` dispatches.
 */
function derivedCandidates(known: Iterable<string>): string[] {
	const words = new Set<string>();
	for (const base of known) {
		if (!/^[a-z]/.test(base)) continue;
		for (const suffix of ["s", "x", "-x", "2"]) words.add(`${base}${suffix}`);
	}
	return [...words];
}

/** Finds a delimiter's matching close while ignoring strings and comments. */
function findClosingDelimiter(
	source: string,
	openingIndex: number,
	opening: string,
	closing: string,
): number {
	let depth = 0;
	let quote: "'" | '"' | "`" | undefined;
	let lineComment = false;
	let blockComment = false;
	for (let i = openingIndex; i < source.length; i++) {
		const character = source[i];
		const next = source[i + 1];
		if (lineComment) {
			if (character === "\n") lineComment = false;
			continue;
		}
		if (blockComment) {
			if (character === "*" && next === "/") {
				blockComment = false;
				i++;
			}
			continue;
		}
		if (quote) {
			if (character === "\\") i++;
			else if (character === quote) quote = undefined;
			continue;
		}
		if (character === "/" && next === "/") {
			lineComment = true;
			i++;
			continue;
		}
		if (character === "/" && next === "*") {
			blockComment = true;
			i++;
			continue;
		}
		if (character === "'" || character === '"' || character === "`") {
			quote = character;
			continue;
		}
		if (character === opening) depth++;
		if (character === closing && --depth === 0) return i;
	}
	throw new Error(`Unclosed ${opening} in source`);
}

function sourceArray(tableName: string): string {
	const declarationIndex = SOURCE.indexOf(`const ${tableName}:`);
	if (declarationIndex < 0) throw new Error(`Missing ${tableName} declaration`);
	const assignmentIndex = SOURCE.indexOf("=", declarationIndex);
	const openingIndex = SOURCE.indexOf("[", assignmentIndex);
	const closingIndex = findClosingDelimiter(SOURCE, openingIndex, "[", "]");
	return SOURCE.slice(openingIndex, closingIndex + 1);
}

function sourceCommandEntry(tableName: string, commandName: string): string {
	const table = sourceArray(tableName);
	const nameIndex = table.indexOf(`name: "${commandName}"`);
	if (nameIndex < 0)
		throw new Error(`${tableName} has no ${commandName} entry`);
	const openingIndex = table.lastIndexOf("{", nameIndex);
	const closingIndex = findClosingDelimiter(table, openingIndex, "{", "}");
	return table.slice(openingIndex, closingIndex + 1);
}

function sourceFunctionBody(functionName: string): string | undefined {
	const declarationIndex = SOURCE.indexOf(`function ${functionName}(`);
	if (declarationIndex < 0) return undefined;
	const openingIndex = SOURCE.indexOf("{", declarationIndex);
	const closingIndex = findClosingDelimiter(SOURCE, openingIndex, "{", "}");
	return SOURCE.slice(openingIndex, closingIndex + 1);
}

function directFlagReads(source: string): Set<string> {
	const reads = new Set<string>();
	for (const match of source.matchAll(/\bflags\.([A-Za-z_$][\w$]*)/g)) {
		const name = match[1];
		if (name) reads.add(name);
	}
	for (const match of source.matchAll(/\bflags\[['"]([^'"]+)['"]\]/g)) {
		const name = match[1];
		if (name) reads.add(name);
	}
	return reads;
}

function handlerFlagReads(tableName: string, commandName: string): Set<string> {
	const entry = sourceCommandEntry(tableName, commandName);
	const runIndex = entry.indexOf("run:");
	const arrowIndex = entry.indexOf("=>", runIndex);
	const openingIndex = entry.indexOf("{", arrowIndex);
	const closingIndex = findClosingDelimiter(entry, openingIndex, "{", "}");
	const body = entry.slice(openingIndex, closingIndex + 1);
	const reads = directFlagReads(body);
	for (const match of body.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*flags\b/g)) {
		const helperBody = sourceFunctionBody(match[1] ?? "");
		if (!helperBody) continue;
		for (const name of directFlagReads(helperBody)) reads.add(name);
	}
	return reads;
}

// This is a lexical check, not full TypeScript data-flow analysis.
// It follows direct flags.property/bracket reads and same-source function calls that receive flags.
// Dynamic keys, aliases, imported helpers, and helpers without a named function declaration are not covered.
const DISPATCHABLE_COMMANDS = [
	...TOP_LEVEL_COMMANDS.map((entry) => ({
		label: entry.name,
		tableName: "TOP_LEVEL_COMMANDS",
		entry,
	})),
	...COMMAND_GROUPS.flatMap((group) =>
		group.commands.map((entry) => ({
			label: `${group.name} ${entry.name}`,
			tableName: `${group.name.toUpperCase()}_COMMANDS`,
			entry,
		})),
	),
];

function setDifference(left: Set<string>, right: Set<string>): string[] {
	return [...left].filter((name) => !right.has(name)).sort();
}

describe("declared command options", () => {
	it("matches every table entry with the flags its handler reads", () => {
		expect(DISPATCHABLE_COMMANDS).toHaveLength(27);
		const mismatches = DISPATCHABLE_COMMANDS.flatMap(
			({ label, tableName, entry }) => {
				const declared = new Set(Object.keys(entry.options));
				const read = handlerFlagReads(tableName, entry.name);
				const undeclared = setDifference(read, declared);
				const unread = setDifference(declared, read);
				return undeclared.length > 0 || unread.length > 0
					? [{ label, undeclared, unread }]
					: [];
			},
		);
		expect(mismatches).toEqual([]);
	});
});

/** One dispatch surface: the argv prefix that reaches it, and what it legitimately accepts. */
interface Surface {
	label: string;
	argvPrefix: string[];
	known: Set<string>;
	rejection: (word: string) => string;
}

const SURFACES: Surface[] = [
	{
		label: "top level",
		argvPrefix: [],
		known: KNOWN_TOP_LEVEL,
		rejection: (word) => `unknown command: ${word}\n`,
	},
	...COMMAND_GROUPS.map((group) => ({
		label: `${group.name} group`,
		argvPrefix: [group.name],
		known: new Set(group.commands.map((c) => c.name)),
		rejection: (word: string) => `unknown ${group.name} subcommand: ${word}\n`,
	})),
];

const LITERAL_CANDIDATES = literalCandidates();

describe.each(
	SURFACES.map((s) => [s.label, s] as const),
)("%s dispatch surface", (_label, surface) => {
	const candidates = [
		...new Set([...LITERAL_CANDIDATES, ...derivedCandidates(surface.known)]),
	]
		.filter((word) => !surface.known.has(word))
		.sort();

	it("accepts nothing its table does not define", async () => {
		const accepted: string[] = [];
		for (const word of candidates) {
			const result = await run([...surface.argvPrefix, word]);
			if (!result.stderr.startsWith(surface.rejection(word))) {
				accepted.push(word);
			}
		}
		expect(accepted).toEqual([]);
	});

	it("tries enough candidate words for that assertion to mean something", () => {
		// Both generators degrading to nothing would leave the assertion
		// above vacuous while still reporting green, so pin the yield to a
		// floor rather than trusting that either found anything.
		expect(candidates.length).toBeGreaterThan(40);
	});
});
