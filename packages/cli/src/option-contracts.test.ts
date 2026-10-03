import { describe, expect, it } from "vitest";
import { COMMAND_GROUPS, run, TOP_LEVEL_COMMANDS } from "./index.js";

// Independent public acceptance contract. Deriving this from the declarations
// would silently bless a new, ineffective flag or a removed supported flag.
// Effects are exercised by index.test.ts: strict/hints/JSON/TTY colour,
// format/write/check, graph limit/field, metadata selectors/sort/reindex and
// planning best/status. This inventory tests acceptance, not those effects.
const PUBLIC_OPTIONS: Record<string, readonly string[]> = {
	check: ["strict", "hints", "json", "no-color"],
	explain: [],
	fmt: ["write", "check", "no-color"],
	delete: ["write", "json", "no-color"],
	rename: ["write", "json", "no-color"],
	render: ["format", "no-color"],
	diff: ["format", "json", "no-color"],
	"graph summary": ["json", "no-color"],
	"graph io": ["json", "no-color"],
	"graph stats": ["limit", "json", "no-color"],
	"graph neighbors": ["json", "no-color"],
	"graph locate": ["field", "json", "no-color"],
	"graph describe": ["json", "no-color"],
	"graph impact": ["json", "no-color"],
	"graph depends-on": ["json", "no-color"],
	"graph path": ["limit", "json", "no-color"],
	"graph edges": ["json", "no-color"],
	"graph orphans": ["json", "no-color"],
	"meta get": ["json", "no-color"],
	"meta list": ["tag", "group", "producer", "json", "no-color"],
	"meta values": ["json", "no-color"],
	"meta set": ["allow-unknown", "json", "no-color"],
	"meta sort": ["by", "write", "check", "no-color"],
	"meta reindex": ["write", "check", "renumber", "json", "no-color"],
	"meta check-links": ["json", "no-color"],
	"status ready": ["best", "json", "no-color"],
	"status blocked": ["json", "no-color"],
	"status list": ["status", "json", "no-color"],
	"status gaps": ["json", "no-color"],
};

const ENTRIES = [
	...TOP_LEVEL_COMMANDS.map((entry) => ({ path: entry.name, entry })),
	...COMMAND_GROUPS.flatMap((group) =>
		group.commands.map((entry) => ({
			path: `${group.name} ${entry.name}`,
			entry,
		})),
	),
];
const STRING_OPTIONS = new Set([
	"format",
	"limit",
	"field",
	"tag",
	"group",
	"producer",
	"by",
	"status",
]);
const ALL_FLAGS = [...new Set(Object.values(PUBLIC_OPTIONS).flat())];

describe("public option acceptance", () => {
	it("accounts for every dispatchable command", () => {
		expect(ENTRIES.map(({ path }) => path).sort()).toEqual(
			Object.keys(PUBLIC_OPTIONS).sort(),
		);
	});

	it.each(ENTRIES)("$path keeps its supported keys and value kinds", ({
		path,
		entry,
	}) => {
		const expected = PUBLIC_OPTIONS[path]!;
		expect(Object.keys(entry.options).sort()).toEqual([...expected].sort());
		for (const key of expected) {
			expect(entry.options[key]?.type, key).toBe(
				STRING_OPTIONS.has(key) ? "string" : "boolean",
			);
		}
	});

	it.each(
		ENTRIES,
	)("$path rejects options belonging only to other commands", async ({
		path,
	}) => {
		const allowed = PUBLIC_OPTIONS[path]!;
		for (const flag of ALL_FLAGS.filter((flag) => !allowed.includes(flag))) {
			const result = await run([...path.split(" "), `--${flag}`]);
			expect(result.exitCode, flag).toBe(2);
			expect(result.stderr, flag).toContain(`unknown option --${flag}`);
		}
	});
});
