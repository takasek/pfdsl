import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let fixture;

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), "check-roadmap-registration-"));
	cpSync(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
	symlinkSync(join(root, "node_modules"), join(fixture, "node_modules"), "dir");
	mkdirSync(join(fixture, ".pfdsl"));
	mkdirSync(join(fixture, "bin"));
	writeFileSync(
		join(fixture, "bin/gh"),
		[
			"#!/usr/bin/env node",
			"const args = process.argv.slice(2);",
			"if (args[0] === 'pr') {",
			"  console.log(JSON.stringify({ closingIssuesReferences: [{ number: Number(process.env.FIXTURE_PR_ISSUE) }] }));",
			"} else if (args[0] === 'label') {",
			"  console.log(JSON.stringify([{ name: 'flow:managed', description: 'tracked in .pfdsl/roadmap.pfdsl' }, { name: 'flow:exempt', description: 'intentionally out of .pfdsl/roadmap.pfdsl scope' }]));",
			"} else if (args[0] === 'issue') {",
			"  console.log(process.env.FIXTURE_ISSUES_JSON);",
			"} else {",
			"  process.exit(97);",
			"}",
		].join("\n"),
	);
	chmodSync(join(fixture, "bin/gh"), 0o755);
	const init = spawnSync("git", ["init", "--quiet"], {
		cwd: fixture,
		encoding: "utf8",
	});
	assert.equal(init.status, 0, init.stderr);
	const remote = spawnSync(
		"git",
		["remote", "add", "origin", "https://github.com/test/fixture.git"],
		{ cwd: fixture, encoding: "utf8" },
	);
	assert.equal(remote.status, 0, remote.stderr);
});

afterEach(() => {
	rmSync(fixture, { recursive: true, force: true });
});

function runWrapper({ roadmap, prIssue, issues }) {
	writeFileSync(join(fixture, ".pfdsl/roadmap.pfdsl"), roadmap);
	return spawnSync(
		process.execPath,
		[join(fixture, "scripts/check-roadmap-registration.mjs"), "--pr", "1"],
		{
			cwd: fixture,
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${join(fixture, "bin")}:${process.env.PATH}`,
				FIXTURE_PR_ISSUE: String(prIssue),
				FIXTURE_ISSUES_JSON: JSON.stringify(issues),
			},
		},
	);
}

const labelsAndNoIssues = {
	state: "OPEN",
	stateReason: null,
	labels: [],
	updatedAt: "2026-09-08T00:00:00Z",
};

describe("check-roadmap-registration", () => {
	it("keeps an unrelated unknown_issue finding and uses a generic remedy", () => {
		const result = runWrapper({
			roadmap: [
				"---",
				"process:",
				"  i42_unrelated:",
				"    label: unrelated",
				"    location: fixture",
				"---",
				"source >> i42_unrelated -> result",
				"",
			].join("\n"),
			prIssue: 99,
			issues: [
				{
					number: 99,
					...labelsAndNoIssues,
					labels: [{ name: "flow:exempt" }],
				},
			],
		});

		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stdout, /#42 unknown_issue/);
		assert.match(result.stderr, /See the audit findings above for details\./);
		assert.doesNotMatch(
			result.stderr,
			/labelled flow:managed but has no process|Add the dependency chain in this PR|flow:exempt if it gates no other work/,
		);
	});

	it("keeps the target missing_process finding and uses a generic remedy", () => {
		const result = runWrapper({
			roadmap: ["---", "process: {}", "---", ""].join("\n"),
			prIssue: 99,
			issues: [
				{
					number: 99,
					...labelsAndNoIssues,
					labels: [{ name: "flow:managed" }],
				},
			],
		});

		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stdout, /#99 missing_process/);
		assert.match(result.stderr, /See the audit findings above for details\./);
		assert.doesNotMatch(
			result.stderr,
			/labelled flow:managed but has no process|Add the dependency chain in this PR|flow:exempt if it gates no other work/,
		);
	});
});
