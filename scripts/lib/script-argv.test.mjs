// #648: the entry scripts read their flags with indexOf/includes, so anything
// they don't recognise is skipped without a word — a typo'd or `--flag=value`
// form of a flag runs the script in a mode the caller did not ask for. The
// worst case reads as success: gate-check.mjs falls back from a strictly
// scoped audit to a coarse one, and reports PASS either way.
//
// These spawn the real scripts rather than unit-testing an extracted parser.
// What has to hold is that the process refuses, and that it refuses before
// doing any work; a parser tested in isolation cannot show that the entry
// point actually consults it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** @param {string} script @param {string[]} args */
function runScript(script, args) {
	const result = spawnSync(process.execPath, [resolve(root, script), ...args], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, GH_HOST: "github.com" },
		// Before the fix these scripts ignore the bad flag and run their whole
		// body, network included. The cap keeps a red run bounded; once the
		// parse rejects, every case returns immediately.
		timeout: 120_000,
	});
	return { status: result.status, stderr: result.stderr ?? "" };
}

// Each entry point gets an argv it must not accept. release.mjs needs a valid
// kind first, since an unknown kind is already rejected on its own and would
// pass this test without any change to the flag handling.
const UNKNOWN_FLAG_CASES = [
	{ script: "scripts/gate-check.mjs", args: ["--definitely-not-a-flag"] },
	{ script: "scripts/cycle-status.mjs", args: ["--definitely-not-a-flag"] },
	{
		script: "scripts/pfdsl/audit-issues-flow.mjs",
		args: ["--definitely-not-a-flag"],
	},
	{ script: "scripts/release.mjs", args: ["cli", "--definitely-not-a-flag"] },
	{
		script: "scripts/gen-skill.mjs",
		args: ["--out", ".claude/skills/pfdsl", "--definitely-not-a-flag"],
	},
	// Outside scripts/, and missed by the first sweep for that reason: the
	// grep that counted the shape only looked at scripts/ and .claude/skills/.
	{
		script: "packages/vscode-extension/esbuild.config.mjs",
		args: ["--definitely-not-a-flag"],
	},
];

describe("entry scripts reject argv they do not understand", () => {
	for (const { script, args } of UNKNOWN_FLAG_CASES) {
		it(`${script} rejects an unknown flag`, () => {
			const { status, stderr } = runScript(script, args);
			assert.notEqual(status, 0, `${script} accepted --definitely-not-a-flag`);
			assert.match(stderr, /definitely-not-a-flag/);
		});
	}

	it("cycle-status.mjs rejects a flag whose value is missing", () => {
		const { status, stderr } = runScript("scripts/cycle-status.mjs", [
			"--base",
		]);
		assert.notEqual(status, 0);
		assert.match(stderr, /--base/);
	});

	// A boolean flag given an inline value is the form that reads as "I asked
	// for the fix": includes("--fix") misses "--fix=true" entirely, so the
	// audit runs read-only while the caller believes it repaired the roadmap.
	it("audit-issues-flow.mjs rejects --fix=true rather than running read-only", () => {
		const { status, stderr } = runScript(
			"scripts/pfdsl/audit-issues-flow.mjs",
			["--fix=true"],
		);
		assert.notEqual(status, 0);
		assert.match(stderr, /--fix/);
	});

	for (const conflictingArgs of [
		["--check-closed-registration", "959", "--fix"],
		["--check-closed-registration", "959", "--enforce-issue", "959"],
	]) {
		it(`audit-issues-flow.mjs rejects conflicting targeted mode: ${conflictingArgs.join(" ")}`, () => {
			const { status, stderr } = runScript(
				"scripts/pfdsl/audit-issues-flow.mjs",
				conflictingArgs,
			);
			assert.equal(status, 2);
			assert.match(stderr, /mutually exclusive/);
		});
	}

	for (const value of ["0", "1.5", "abc"]) {
		it(`audit-issues-flow.mjs rejects invalid --check-closed-registration ${JSON.stringify(value)}`, () => {
			const { status, stderr } = runScript(
				"scripts/pfdsl/audit-issues-flow.mjs",
				["--check-closed-registration", value],
			);
			assert.equal(status, 2);
			assert.match(stderr, /--check-closed-registration/);
		});
	}

	// The inline form of a value-taking flag has to reach the script, not be
	// skipped: indexOf("--artifact") does not see "--artifact=k", so the
	// conflict with --no-artifact goes unreported and the gate scopes itself
	// coarsely instead of stopping.
	it("gate-check.mjs sees --artifact=k in its inline form", () => {
		const { status, stderr } = runScript("scripts/gate-check.mjs", [
			"--artifact=k",
			"--no-artifact",
		]);
		assert.equal(status, 2);
		assert.match(stderr, /mutually exclusive/);
	});

	// The skill generators guard --out against writing outside a skill tree.
	// Reaching that guard is the evidence the inline form was read at all:
	// indexOf("--out") misses "--out=…" and the generators print their usage
	// instead, as though no destination had been named.
	it("gen-skill.mjs reads --out in its inline form", () => {
		const { status, stderr } = runScript("scripts/gen-skill.mjs", [
			"--out=/tmp/pfdsl-argv-probe",
		]);
		assert.equal(status, 1);
		assert.match(
			stderr,
			/must contain a '\.claude' or 'skills' directory component/,
		);
	});

	// Strict parsing accepts any string for a `type: "string"` flag, so a value
	// that is not an issue number passes the parse and becomes NaN downstream.
	// `gh issue view NaN` then fails, and the failure is reported as the issue's
	// checks being unavailable — a row that reads like a tool outage rather than
	// a typo, on a table whose other rows are green (#745).
	for (const script of ["scripts/gate-check.mjs", "scripts/cycle-status.mjs"]) {
		for (const value of ["abc", "#744", "744.5", ""]) {
			it(`${script} rejects --issue ${JSON.stringify(value)}`, () => {
				const { status, stderr } = runScript(script, ["--issue", value]);
				assert.equal(status, 2);
				assert.match(stderr, /--issue/);
			});
		}

		it(`${script} names the offending --issue value`, () => {
			const { stderr } = runScript(script, [
				"--issue",
				"744",
				"--issue",
				"abc",
			]);
			assert.match(stderr, /abc/);
		});
	}

	// Mutual exclusion is a script-level rule that strict parsing does not
	// replace (#564) — it still has to hold for the separated form.
	it("gate-check.mjs still rejects --artifact together with --no-artifact", () => {
		const { status, stderr } = runScript("scripts/gate-check.mjs", [
			"--artifact",
			"k",
			"--no-artifact",
		]);
		assert.equal(status, 2);
		assert.match(stderr, /mutually exclusive/);
	});
});
