// The adoption procedure in github-issues-backend.md tells an adopter to create
// the flow labels with gh. The audit compares each label's description with
// FLOW_LABELS exactly, so a command whose name or description drifts from
// FLOW_LABELS makes a freshly set-up repository fail its first audit. This
// test reads the commands out of the reference and holds them to FLOW_LABELS in
// both directions.
//
// It lives here, beside adopter-dependency-setup.test.mjs, and not under
// scripts/pfdsl/lib/: scripts/lib/install-templates.mjs distributes an explicit
// list, so no *.test.mjs under scripts/pfdsl/ ships to adopters, who do not
// have the reference's source path either.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FLOW_LABELS } from "./lib/issues-flow-audit.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const REFERENCE = ".claude/skills/pfd-ops/references/github-issues-backend.md";

// The one command shape the reference uses. A description with a quote, `$`,
// backtick or backslash would not survive the double quotes, so such a
// description is reported as an unparseable command instead of being compared.
const COMMAND = /^gh label create (\S+) --description "([^"$`\\]*)" --force$/;

function extractLabelCommands(markdown) {
	const lines = markdown
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("gh label create"));
	return lines.map((line) => {
		const match = COMMAND.exec(line);
		assert.ok(
			match,
			`not in the form gh label create <name> --description "<desc>" --force: ${line}`,
		);
		return { name: match[1], description: match[2] };
	});
}

const reference = readFileSync(join(root, REFERENCE), "utf8");

test("the reference's label commands create exactly the labels the audit expects", () => {
	const commands = extractLabelCommands(reference);
	assert.deepEqual(
		[...commands].sort((a, b) => a.name.localeCompare(b.name)),
		[...FLOW_LABELS].sort((a, b) => a.name.localeCompare(b.name)),
	);
});

test("every FLOW_LABELS entry has a command and no command names another label", () => {
	const commands = extractLabelCommands(reference);
	const commanded = commands.map((c) => c.name);
	for (const { name } of FLOW_LABELS) {
		assert.equal(
			commanded.filter((n) => n === name).length,
			1,
			`expected exactly one command for ${name}`,
		);
	}
	for (const name of commanded) {
		assert.ok(
			FLOW_LABELS.some((label) => label.name === name),
			`${name} is not in FLOW_LABELS`,
		);
	}
});

test("the extractor rejects a command that is not in the documented shape", () => {
	assert.throws(
		() =>
			extractLabelCommands(
				'gh label create flow:managed --description "a \\"b\\"" --force',
			),
		/not in the form/,
	);
	assert.throws(
		() =>
			extractLabelCommands(
				'gh label create flow:managed --description "tracked in .pfdsl/roadmap.pfdsl"',
			),
		/not in the form/,
	);
});
