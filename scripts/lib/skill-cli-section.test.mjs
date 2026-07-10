import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { renderCliSection } from "./skill-cli-section.mjs";

const HELP_FIXTURE = `pfdsl <command> [options]

Commands:
  check <file|-> [--audit] [--json]
                           Validate a .pfdsl file (- = stdin)
                           --audit    list terminal artifacts
                           --json     output diagnostics as JSON
  status-set <file> <artifact-id> <status> [--json]
                           Set artifact status (todo|wip|done|waiting|suspended) in place
                           Roadmap files: prints newly-ready processes after the change
                           --json    output as JSON
  help                     Show this help

Exit codes:
  0  success (warnings are non-fatal)
  2  invalid usage (missing argument, unknown flag or subcommand)
`;

describe("renderCliSection", () => {
	it("renders one npx line per command with its first description line as a comment", () => {
		const lines = renderCliSection(HELP_FIXTURE).split("\n");
		assert.deepEqual(lines, [
			"npx @pfdsl/cli check <file|-> [--audit] [--json]   # Validate a .pfdsl file (- = stdin)",
			"npx @pfdsl/cli status-set <file> <artifact-id> <status> [--json]   # Set artifact status (todo|wip|done|waiting|suspended) in place",
			"npx @pfdsl/cli help   # Show this help",
		]);
	});

	it("ignores flag detail lines, extra description lines, and the exit-codes section", () => {
		const out = renderCliSection(HELP_FIXTURE);
		assert.ok(!out.includes("--audit    list"));
		assert.ok(!out.includes("newly-ready"));
		assert.ok(!out.includes("Exit codes"));
		assert.ok(!out.includes("invalid usage"));
	});

	it("throws when the Commands section is absent", () => {
		assert.throws(() => renderCliSection("pfdsl <command>\n\nnothing\n"));
	});
});
