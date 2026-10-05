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
			"  const number = Number(process.env.FIXTURE_PR_ISSUE);",
			"  const refs = process.env.FIXTURE_CLOSING_REFS ? JSON.parse(process.env.FIXTURE_CLOSING_REFS) : [{ id: 'issue:' + number, number, url: 'https://github.com/test/fixture/issues/' + number, repository: { id: 'repo:fixture', name: 'fixture', owner: { id: 'owner:test', login: 'test' } } }];",
			"  console.log(JSON.stringify({ closingIssuesReferences: refs }));",
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

function runWrapper({ roadmap, prIssue, issues, closingRefs }) {
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
				FIXTURE_CLOSING_REFS: closingRefs ? JSON.stringify(closingRefs) : "",
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

function closingRef(number, owner = "test", repo = "fixture") {
	return {
		id: `issue:${owner}/${repo}#${number}`,
		number,
		url: `https://github.com/${owner}/${repo}/issues/${number}`,
		repository: {
			id: `repo:${owner}/${repo}`,
			name: repo,
			owner: { id: `owner:${owner}`, login: owner },
		},
	};
}

describe("check-roadmap-registration", () => {
	for (const ref of [
		closingRef(99, "other"),
		closingRef(99, "test", "other"),
	]) {
		it(`does not audit a foreign #99 in ${ref.repository.owner.login}/${ref.repository.name}`, () => {
			const result = runWrapper({
				roadmap: "---\nprocess: {}\n---\n",
				closingRefs: [ref],
				issues: [
					{
						number: 99,
						...labelsAndNoIssues,
						labels: [{ name: "flow:managed" }],
					},
				],
			});
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stdout, /SKIP.*no issue in this repository/);
			assert.doesNotMatch(result.stdout, /missing_process/);
		});
	}

	it("enforces local references while leaving foreign same-number issues advisory", () => {
		const result = runWrapper({
			roadmap: "---\nprocess: {}\n---\n",
			closingRefs: [closingRef(99), closingRef(42, "other")],
			issues: [
				{ number: 99, ...labelsAndNoIssues, labels: [{ name: "flow:exempt" }] },
				{
					number: 42,
					...labelsAndNoIssues,
					labels: [{ name: "flow:managed" }],
				},
			],
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /PASS.*#99/);
		assert.doesNotMatch(result.stdout, /FAIL/);
	});

	it("does not turn a number-only response into a successful skip", () => {
		const result = runWrapper({
			roadmap: "---\nprocess: {}\n---\n",
			closingRefs: [{ number: 99 }],
			issues: [],
		});
		assert.equal(result.status, 1);
		assert.match(result.stderr, /malformed.*closingIssuesReferences/);
		assert.doesNotMatch(result.stdout, /SKIP/);
	});

	it("keeps an unrelated unknown_issue visible without blocking this PR", () => {
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

		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /#42 unknown_issue/);
		assert.match(result.stdout, /advisory/);
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
