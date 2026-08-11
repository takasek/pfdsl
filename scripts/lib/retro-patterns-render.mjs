/**
 * retro-patterns.mjs's printing, as pure functions that return text instead
 * of calling console.log — so the shape of what a reader sees (section
 * headings, line order, count phrasing) is something a test can assert on,
 * not something only a human staring at a terminal can (#820).
 *
 * `console.log(x)` writes `x + "\n"`; a run of them is byte-identical to
 * `[...xs].join("\n") + "\n"`. Every render* function below returns the
 * `join("\n")` half — the caller (renderCommand, or the CLI for `check`)
 * adds the final newline once when it prints.
 */

import { parseArgs } from "node:util";
import {
	checkPatternFile,
	collectTags,
	groupTagsByAxis,
	keyLinesOf,
	near,
	select,
	summaryOf,
} from "./retro-patterns.mjs";

/**
 * One pattern, formatted as head line, optional note, path, summary, and any
 * `問いの形` / `具体例` key lines.
 * @param {{name: string, tags: string[], body: string, path: string}} pattern
 * @param {string} [note] - printed under the head line, where a reader looks
 *   for why this entry is in front of them at all.
 * @returns {string}
 */
export function renderPattern({ name, tags, body, path }, note) {
	const lines = [`${name}  [${tags.join(", ")}]`];
	if (note !== undefined) lines.push(`  ${note}`);
	lines.push(`  ${path}`);
	lines.push(`  ${summaryOf(body)}`);
	for (const line of keyLinesOf(body)) lines.push(`  ${line}`);
	return lines.join("\n");
}

/** @param {{name: string, tags: string[], body: string, path: string}[]} patterns */
export function renderTags(patterns) {
	const lines = [];
	for (const { axis, tags } of groupTagsByAxis(collectTags(patterns))) {
		lines.push(`[${axis || "no axis"}]`);
		for (const { tag, patterns: tagged } of tags) {
			lines.push(`  ${tag}  ${tagged.length}`);
			for (const p of tagged) lines.push(`    ${p.name}  ${p.path}`);
		}
	}
	lines.push(
		`\n${patterns.length} pattern(s). Pick the tags whose condition held this cycle; --tag unions them.`,
	);
	return lines.join("\n");
}

/**
 * @param {{name: string, tags: string[], body: string, path: string}[]} patterns
 * @param {{tags: string[], words: string[]}} query
 */
export function renderSelection(patterns, query) {
	const { tagged, wordOnly, always, reach, pool, unselective } = select(
		patterns,
		query,
	);
	const lines = [];

	lines.push(`## tagged (${tagged.length} of ${pool})`);
	if (unselective) {
		lines.push(
			`  ${tagged.length} of ${pool} is not a narrowing — the tags held too widely this cycle.`,
		);
		lines.push(
			"  Read down the ranking, not across the list, and do not treat the end of it as the end of the audit.",
		);
	}
	for (const { pattern, matched } of tagged)
		lines.push(
			renderPattern(
				pattern,
				`matched ${matched.length}/${query.tags.length}: ${matched.join(", ")}`,
			),
		);

	lines.push(
		`\n## word-only (${wordOnly.length} of ${pool - tagged.length}) — what the tags missed`,
	);
	if (reach.length > 0) {
		lines.push(
			`  reach before subtraction: ${reach.map((r) => `${r.word} ${r.count}`).join(", ")}`,
		);
		lines.push(
			"  reach counts patterns; `near --word <word>` names which, the tagged ones included.",
		);
	}
	if (query.words.length === 0) {
		lines.push(
			"  no --word given. Tags only answer what someone anticipated; pass a few",
		);
		lines.push(
			"  concrete terms from this cycle's diff to see what they did not.",
		);
	}
	for (const { pattern, hits } of wordOnly) {
		lines.push(renderPattern(pattern));
		for (const h of hits) lines.push(`    L${h.line} ${h.word}: ${h.text}`);
	}

	lines.push(`\n## always (${always.length})`);
	for (const p of always) lines.push(renderPattern(p));

	const shown = tagged.length + wordOnly.length + always.length;
	lines.push(
		`\nShown ${shown} of ${patterns.length} — shown, not read. Open the paths above.`,
	);
	return lines.join("\n");
}

/**
 * Every pattern, one rendered block each, in catalog order.
 * @param {{name: string, tags: string[], body: string, path: string}[]} patterns
 * @returns {string}
 */
export function renderList(patterns) {
	return patterns.map((p) => renderPattern(p)).join("\n");
}

/**
 * @param {{name: string, tags: string[], body: string, path: string}[]} patterns
 * @param {string[]} words
 */
export function renderNear(patterns, words) {
	const matches = near(patterns, words);
	const lines = [
		`## near (${matches.length}) — ranked by how many lines the words hit, most first. Open the top few before writing a new pattern.`,
	];
	for (const { pattern, hits } of matches) {
		lines.push(renderPattern(pattern));
		for (const h of hits) lines.push(`    L${h.line} ${h.word}: ${h.text}`);
	}
	return lines.join("\n");
}

/**
 * Every pattern file's violations, one line per violation as `path: reason`,
 * or a single summary line when every file is clean. Runs checkPatternFile
 * per file rather than through parsePatternFile, so a single unparsable file
 * is reported as one violation among the rest instead of throwing.
 * @param {{path: string, name: string, text: string}[]} files
 * @returns {{text: string, clean: boolean}}
 */
export function renderCheck(files) {
	let clean = true;
	const lines = [];
	for (const file of files) {
		for (const reason of checkPatternFile(file)) {
			clean = false;
			lines.push(`${file.path}: ${reason}`);
		}
	}
	if (clean) lines.push(`${files.length} pattern file(s), no violations.`);
	return { text: lines.join("\n"), clean };
}

/**
 * The one place a subcommand's name, its argument shape, and the long
 * option names `parseArgs` must accept are declared together (#810). Usage
 * text, the `parseArgs` options passed to it, and `check`'s binding
 * cross-check are all generated from this, so a subcommand or option can't
 * drift between the three separate listings this replaces (the header
 * comment, the usage error message, and the binding's own bash examples).
 * @type {{name: string, argsUsage: string, options: string[]}[]}
 */
export const SUBCOMMANDS = [
	{ name: "tags", argsUsage: "", options: [] },
	{ name: "list", argsUsage: "", options: [] },
	{
		name: "select",
		argsUsage: "[--tag <tag>]... [--word <word>]...",
		options: ["tag", "word"],
	},
	{ name: "near", argsUsage: "--word <word>...", options: ["word"] },
	{ name: "check", argsUsage: "", options: [] },
];

/** @returns {string} */
export function usageText() {
	const lines = ["usage:"];
	for (const { name, argsUsage } of SUBCOMMANDS)
		lines.push(
			`  node scripts/retro-patterns.mjs ${name}${argsUsage ? ` ${argsUsage}` : ""}`,
		);
	return lines.join("\n");
}

/**
 * The `parseArgs` `options` for every long option any subcommand declares.
 * One shared shape rather than one per subcommand: `select` and `near` both
 * parse through `parseQuery`, and `near` needs `--tag` recognized (not
 * rejected as "unknown option") so it can reject it itself with a
 * subcommand-specific message ("near takes no --tag").
 * @returns {Record<string, {type: "string", multiple: true}>}
 */
function parseArgsOptions() {
	const names = new Set(SUBCOMMANDS.flatMap((s) => s.options));
	return Object.fromEntries(
		[...names].map((n) => [n, { type: "string", multiple: true }]),
	);
}

/**
 * Repeated `--tag` / `--word` options. Strict parsing, not a hand-rolled
 * argv walk: a walk that only recognizes the bare `--flag value` form drops
 * the `--flag=value` spelling silently and calls it done rather than an
 * unrecognized flag — the defect scripts/gate-check.mjs's own parseArgs
 * migration was written to close (#648).
 * @param {string[]} argv
 * @returns {{tags: string[], words: string[]}}
 */
export function parseQuery(argv) {
	const { values } = parseArgs({
		args: argv,
		options: parseArgsOptions(),
		strict: true,
		allowPositionals: false,
	});
	return { tags: values.tag ?? [], words: values.word ?? [] };
}

/**
 * The `--word` options of a query whose `--tag` is refused rather than
 * ignored. Ranking a draft against the whole catalog has no cycle whose tags
 * would narrow it, so a tag here means the caller expected `select`.
 * @param {string[]} argv
 * @returns {string[]}
 */
export function parseWords(argv) {
	const { tags, words } = parseQuery(argv);
	if (tags.length > 0) {
		throw new Error("near takes no --tag: it ranks the whole catalog");
	}
	return words;
}

/** A fenced ```bash ... ``` block's contents. */
const BASH_BLOCK = /```bash\n([\s\S]*?)```/g;

/** A binding line invoking this CLI, capturing the subcommand name. */
const INVOCATION_LINE = /^node scripts\/retro-patterns\.mjs\s+(\S+)(.*)$/;

/** A long option token, e.g. `--tag`, capturing the name without its dashes. */
const LONG_OPTION = /--([a-z][a-z-]*)/g;

/**
 * The subcommand names and long option names a binding's bash examples
 * actually show.
 * @param {string} bindingText
 * @returns {{names: Set<string>, options: Set<string>}}
 */
function extractBindingUsage(bindingText) {
	const names = new Set();
	const options = new Set();
	for (const [, block] of bindingText.matchAll(BASH_BLOCK)) {
		for (const rawLine of block.split("\n")) {
			const line = rawLine.split("#")[0];
			const m = INVOCATION_LINE.exec(line);
			if (!m) continue;
			names.add(m[1]);
			for (const [, opt] of line.matchAll(LONG_OPTION)) options.add(opt);
		}
	}
	return { names, options };
}

/**
 * Where a binding's bash examples and the subcommand definitions disagree,
 * in either direction: a name or option the binding shows that no
 * definition declares, or one a definition declares that the binding never
 * shows. Checking options as well as names catches a rename (`--word` →
 * `--words`) that a name-only diff would miss — the binding would still name
 * the right subcommand, and only a reader who copies its example would hit
 * `unknown option` at run time (#810).
 * @param {string} bindingText
 * @param {{name: string, options: string[]}[]} definitions
 * @returns {string[]}
 */
export function checkBindingUsage(bindingText, definitions) {
	const { names: bindingNames, options: bindingOptions } =
		extractBindingUsage(bindingText);
	const definedNames = new Set(definitions.map((d) => d.name));
	const definedOptions = new Set(definitions.flatMap((d) => d.options));

	return [
		...disagreements(bindingNames, definedNames, {
			onlyInBinding: (name) =>
				`binding shows subcommand "${name}" that no definition declares`,
			onlyInDefinitions: (name) =>
				`definitions declare subcommand "${name}" that the binding never shows`,
		}),
		...disagreements(bindingOptions, definedOptions, {
			onlyInBinding: (opt) =>
				`binding uses --${opt} that no definition declares`,
			onlyInDefinitions: (opt) =>
				`definitions declare --${opt} that the binding never shows`,
		}),
	];
}

/**
 * Both directions of a set difference, phrased by the caller. Reported in
 * both directions because either one alone leaves the other silent: a stale
 * binding example and an undocumented subcommand are the same drift seen from
 * opposite sides.
 * @param {Set<string>} binding
 * @param {Set<string>} defined
 * @param {{onlyInBinding: (v: string) => string, onlyInDefinitions: (v: string) => string}} phrase
 * @returns {string[]}
 */
function disagreements(binding, defined, phrase) {
	return [
		...[...binding].filter((v) => !defined.has(v)).map(phrase.onlyInBinding),
		...[...defined]
			.filter((v) => !binding.has(v))
			.map(phrase.onlyInDefinitions),
	];
}

/**
 * `check`'s full report: pattern file violations (renderCheck) plus the
 * binding cross-check (checkBindingUsage), combined into one text and one
 * ok flag. When both are clean the text is renderCheck's own summary line
 * unchanged — the binding check adds nothing to see when it finds nothing.
 * @param {{path: string, name: string, text: string}[]} files
 * @param {string} bindingText
 * @returns {{text: string, ok: boolean}}
 */
function renderCheckCommand(files, bindingText) {
	const { text: fileText, clean: filesClean } = renderCheck(files);
	const bindingViolations = checkBindingUsage(bindingText, SUBCOMMANDS);
	const ok = filesClean && bindingViolations.length === 0;
	if (ok) return { text: fileText, ok: true };
	const lines = [];
	if (!filesClean) lines.push(fileText);
	lines.push(...bindingViolations);
	return { text: lines.join("\n"), ok: false };
}

/**
 * The sole binding of a subcommand name to the render function that answers
 * it. Kept as one function precisely so a mistake here — near wired to
 * renderSelection, say — shows up in a test that asserts on which heading
 * came back, rather than only in a human reading the terminal (#820).
 *
 * Inputs arrive as loaders rather than as loaded values so that which
 * subcommand needs which input stays here too, instead of being re-derived by
 * the caller from the same command string. That seam is load-bearing: `check`
 * must read the pattern files without parsing them, because parsing is the
 * very thing it reports per file instead of aborting on.
 * @param {string | undefined} command
 * @param {string[]} argv
 * @param {{loadPatterns: () => {name: string, tags: string[], body: string, path: string}[], loadPatternFiles: () => {path: string, name: string, text: string}[], loadBinding: () => string}} load
 * @returns {{text: string, ok: boolean}}
 */
export function renderCommand(
	command,
	argv,
	{ loadPatterns, loadPatternFiles, loadBinding },
) {
	if (command === "check")
		return renderCheckCommand(loadPatternFiles(), loadBinding());
	if (command === "tags") return { text: renderTags(loadPatterns()), ok: true };
	if (command === "list") return { text: renderList(loadPatterns()), ok: true };
	if (command === "select")
		return {
			text: renderSelection(loadPatterns(), parseQuery(argv)),
			ok: true,
		};
	if (command === "near") {
		const words = parseWords(argv);
		if (words.length === 0)
			throw new Error("near requires at least one --word");
		return { text: renderNear(loadPatterns(), words), ok: true };
	}
	return { text: usageText(), ok: false };
}
