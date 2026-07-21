import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderCliSection } from "./skill-cli-section.mjs";

const HELP_FIXTURE = `pfdsl <command> [options]

Commands:
  check <file|-> [--hints] [--json]
                           Validate a .pfdsl file (- = stdin)
                           --hints    list consumer-asymmetry hints
                           --json     output diagnostics as JSON
  meta set <file> <artifact-id> <field> <value> [--json]
                           Set a scalar frontmatter field in place
                           Roadmap files: prints newly-ready processes after the change
                           --json    output as JSON
  help                     Show this help

Exit codes:
  0  success (warnings are non-fatal)
  2  invalid usage (missing argument, unknown flag or subcommand)
`;

describe("renderCliSection", () => {
	it("renders one pfdsl line per command with its first description line as a comment", () => {
		const lines = renderCliSection(HELP_FIXTURE).split("\n");
		assert.deepEqual(lines, [
			"pfdsl check <file|-> [--hints] [--json]   # Validate a .pfdsl file (- = stdin)",
			"pfdsl meta set <file> <artifact-id> <field> <value> [--json]   # Set a scalar frontmatter field in place",
			"pfdsl help   # Show this help",
		]);
	});

	it("ignores flag detail lines, extra description lines, and the exit-codes section", () => {
		const out = renderCliSection(HELP_FIXTURE);
		assert.ok(!out.includes("--hints    list"));
		assert.ok(!out.includes("newly-ready"));
		assert.ok(!out.includes("Exit codes"));
		assert.ok(!out.includes("invalid usage"));
	});

	it("throws when the Commands section is absent", () => {
		assert.throws(() => renderCliSection("pfdsl <command>\n\nnothing\n"));
	});
});

const GROUPS_FIXTURE = `pfdsl <command> [options]

Commands:
  check <file|-> [--strict] [--json]
                           Validate a .pfdsl file (- = stdin)

Command groups (run \`pfdsl <group>\` for their subcommands):
  graph summary|io|stats|neighbors|impact|depends-on|path|edges
                           Read-only queries on the graph topology
  meta get|set|sort|reindex
                           Read and write frontmatter metadata
  status ready|gaps        Planning queries derived from artifact status

  help                     Show this help

Exit codes:
  0  success (warnings are non-fatal)
`;

describe("renderCliSection with command groups", () => {
	it("includes the Command groups entries, not just the top-level Commands", () => {
		const lines = renderCliSection(GROUPS_FIXTURE).split("\n");
		assert.deepEqual(lines, [
			"pfdsl check <file|-> [--strict] [--json]   # Validate a .pfdsl file (- = stdin)",
			"pfdsl graph summary|io|stats|neighbors|impact|depends-on|path|edges   # Read-only queries on the graph topology",
			"pfdsl meta get|set|sort|reindex   # Read and write frontmatter metadata",
			"pfdsl status ready|gaps   # Planning queries derived from artifact status",
			"pfdsl help   # Show this help",
		]);
	});

	it("stops at the Exit codes section", () => {
		const out = renderCliSection(GROUPS_FIXTURE);
		assert.ok(!out.includes("Exit codes"));
		assert.ok(!out.includes("warnings are non-fatal"));
	});
});
