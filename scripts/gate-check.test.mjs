import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fixture;

function git(args) {
	const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
}

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), "gate-check-record-recovery-"));
	cpSync(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
	// Isolate unrelated project-wide checks; the gate entrypoint, its steps,
	// commit lint and all git history queries run unchanged.
	writeFileSync(
		join(fixture, "scripts/pfdsl/audit-issues-flow.mjs"),
		"process.exit(0);\n",
	);
	writeFileSync(join(fixture, "Makefile"), "check-docs:\n\t@true\n");
	git(["init", "--bare", "remote.git"]);
	git(["init", "--initial-branch=main"]);
	git(["config", "user.email", "test@example.com"]);
	git(["config", "user.name", "Test User"]);
	git(["commit", "--allow-empty", "-m", "test: establish main"]);
	git(["remote", "add", "origin", join(fixture, "remote.git")]);
	git(["push", "origin", "HEAD:main"]);
	mkdirSync(join(fixture, "packages/example"), { recursive: true });
	writeFileSync(
		join(fixture, "packages/example/index.js"),
		"export const value = 1;\n",
	);
	git(["add", "packages/example/index.js"]);
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

function runGate(args = []) {
	return spawnSync(
		process.execPath,
		[join(fixture, "scripts/gate-check.mjs"), "--no-artifact", ...args],
		{
			cwd: fixture,
			encoding: "utf8",
		},
	);
}

describe("gate-check record recovery", () => {
	for (const message of [
		"fix: correct value",
		"fix: correct value\n\nReview: tool=subagent",
	]) {
		it(`accepts code changes without requiring review trailers: ${JSON.stringify(message)}`, () => {
			git(["commit", "-m", message]);
			const result = runGate();
			assert.equal(result.status, 0, result.stdout + result.stderr);
			assert.doesNotMatch(result.stdout, /Review record|malformed record/);
			assert.match(result.stdout, /PASS commit subject lint/);
		});
	}

	it("still rejects an invalid commit subject", () => {
		git(["commit", "-m", "invalid subject"]);
		const result = runGate();
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /FAIL commit subject lint/);
	});
});

describe("gate-check human review routing", () => {
	function stubIssues(failures = {}) {
		writeFileSync(
			join(fixture, "scripts/pfdsl/lib/github-ops.mjs"),
			`
import { appendFileSync } from 'node:fs';
export function createGitHubOps() {
  return {
    viewIssue: async ({ number, fields }) => {
      appendFileSync('issue-reads.jsonl', JSON.stringify({ number, fields }) + '\\n');
      const failure = ${JSON.stringify(failures)}[number];
      if (failure) throw Object.assign(new Error(failure.message), { code: failure.code });
      return { body: '設計未確定', comments: [] };
    },
    designRecordEditInfo: async () => { throw new Error('unexpected edit history lookup'); }
  };
}
`,
		);
		git(["commit", "-m", "fix: correct value"]);
	}

	it("names every explicit issue in manual guidance without a record verdict", () => {
		stubIssues();
		const result = runGate(["--issue", "1208", "--issue", "1221"]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.doesNotMatch(
			result.stdout,
			/design-selection record|record-posted|record-incomplete/,
		);
		assert.match(result.stdout, /Manual checks:[\s\S]*#1208, #1221/);
		assert.match(result.stdout, /PASS commit subject lint/);
		const reads = readFileSync(join(fixture, "issue-reads.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map(JSON.parse);
		assert.deepEqual(
			reads.map(({ number }) => number),
			[1208, 1221],
		);
		assert.ok(reads.every(({ fields }) => fields.includes("comments")));
	});

	it("does not infer a terminal issue or claim review when none was specified", () => {
		stubIssues();
		const result = runGate();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.doesNotMatch(result.stdout, /design-selection record/);
		assert.match(
			result.stdout,
			/Manual checks:[\s\S]*no --issue.*no issue review is implied/,
		);
	});

	for (const [code, message, status, verdict] of [
		[undefined, "HTTP 404: issue not found", 1, "FAIL"],
		[undefined, "authentication failed", 1, "FAIL"],
		[undefined, "network unavailable", 1, "FAIL"],
		["ENOENT", "spawn gh ENOENT", 0, "SKIP"],
	]) {
		it(`preserves issue lookup handling: ${message}`, () => {
			stubIssues({ 1208: { code, message } });
			const result = runGate(["--issue", "1208", "--issue", "1221"]);
			assert.equal(result.status, status, result.stdout + result.stderr);
			assert.match(
				result.stdout,
				new RegExp(`${verdict} issue read \\(#1208\\)`),
			);
			assert.match(result.stdout, /Manual checks:[\s\S]*#1208, #1221/);
			assert.doesNotMatch(result.stdout, /design-selection record/);
		});
	}
});

describe("gate-check gen-plugin trigger", () => {
	function publishHookSource(path = "hooks/example.mjs") {
		mkdirSync(join(fixture, "hooks"), { recursive: true });
		writeFileSync(join(fixture, path), "export {};\n");
		git(["add", path]);
		git(["commit", "-m", "test: add a gen-plugin source"]);
		git(["push", "origin", "HEAD:main"]);
	}

	const identityRow = (stdout) =>
		stdout.split("\n").find((line) => line.includes("gen-plugin identity"));

	for (const path of ["hooks/日本語.mjs", "hooks/line\nbreak.mjs"]) {
		for (const change of ["delete", "move"]) {
			it(`regenerates after ${change} of a quoted Git path: ${JSON.stringify(path)}`, () => {
				git(["config", "core.quotePath", "true"]);
				publishHookSource(path);
				git(
					change === "delete"
						? ["rm", "--quiet", path]
						: ["mv", path, "packages/example/moved.mjs"],
				);
				git(["commit", "-m", `fix: ${change} the hook source`]);
				const row = identityRow(runGate().stdout);
				assert.ok(row, "expected a gen-plugin identity row");
				assert.match(row, /FAIL/);
			});
		}
	}

	it("regenerates when a branch only deletes a generator input", () => {
		publishHookSource();
		git(["rm", "--quiet", "hooks/example.mjs"]);
		git(["commit", "-m", "fix: drop the hook source"]);
		const row = identityRow(runGate().stdout);
		assert.ok(row, "expected a gen-plugin identity row");
		assert.doesNotMatch(row, /SKIP/);
	});

	it("regenerates when a branch moves a generator input out of the trigger", () => {
		publishHookSource();
		git(["mv", "hooks/example.mjs", "packages/example/moved.mjs"]);
		git(["commit", "-m", "fix: move the hook source"]);
		const row = identityRow(runGate().stdout);
		assert.ok(row, "expected a gen-plugin identity row");
		assert.doesNotMatch(row, /SKIP/);
	});
});
