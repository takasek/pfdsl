/**
 * The shared commit-subject verdict: the range it asks git for, and how it
 * reads what comes back.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkCommitSubjects } from "./commit-subjects.mjs";

/**
 * Records the command lines a step issues and replies with canned output, so a
 * test can assert on the range a caller asked git for without running git.
 */
function fakeExec(responses = {}) {
	/** @type {string[]} */
	const calls = [];
	const exec = (file, args = []) => {
		const line = [file, ...args].join(" ");
		calls.push(line);
		const hit = Object.entries(responses).find(([prefix]) =>
			line.startsWith(prefix),
		);
		return { ok: hit?.[1].ok ?? true, out: hit?.[1].out ?? "" };
	};
	return { exec, calls };
}

/**
 * What `git log --format=%h%x09%s` emits: each line anchored by a sha, so a
 * commit with an empty message stays a record instead of vanishing into a
 * newline split.
 * @param {string[]} subjects
 */
function logOutput(subjects) {
	return subjects.map((s, i) => `sha${i}\t${s}\n`).join("");
}

describe("checkCommitSubjects", () => {
	it("reads the range the caller names, rather than a fixed origin/<base>..HEAD", () => {
		const { exec, calls } = fakeExec({
			"git log": { out: logOutput(["feat(cli): a"]) },
		});
		checkCommitSubjects({
			exec,
			baseRef: "abc123",
			headRef: "def456",
		});
		// The whole argument set, compared without regard to order: a substring
		// check would still pass if a traversal-narrowing option such as
		// --first-parent were added, and that silently drops the commits a merge
		// brings in through its side parent. Order carries no meaning to git
		// here, so pinning it would only make a reorder a red test.
		assert.deepEqual(
			calls
				.find((c) => c.startsWith("git log"))
				?.split(" ")
				.sort(),
			["--format=%h%x09%s", "--no-merges", "abc123..def456", "git", "log"],
		);
	});

	it("excludes merge commits so a base merge cannot fail the lint (#690)", () => {
		const { exec, calls } = fakeExec({
			"git log": { out: logOutput(["feat(cli): a"]) },
		});
		checkCommitSubjects({
			exec,
			baseRef: "origin/main",
			headRef: "HEAD",
		});
		const logCall = calls.find((c) => c.startsWith("git log"));
		assert.ok(
			logCall?.includes("--no-merges"),
			`expected --no-merges in the log call, got: ${logCall}`,
		);
	});

	it("SKIPs when the range holds no non-merge commits", () => {
		const { exec } = fakeExec({ "git log": { out: "" } });
		const result = checkCommitSubjects({
			exec,
			baseRef: "origin/main",
			headRef: "HEAD",
		});
		assert.equal(result.status, "SKIP");
	});

	it("FAILs and surfaces git's message when the range cannot be read", () => {
		const { exec } = fakeExec({
			"git log": { ok: false, out: "fatal: bad revision" },
		});
		const result = checkCommitSubjects({
			exec,
			baseRef: "origin/nope",
			headRef: "HEAD",
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /bad revision/);
	});

	it("PASSes and counts the subjects it linted", () => {
		const { exec } = fakeExec({
			"git log": { out: logOutput(["feat(cli): a", "fix(cli): b"]) },
		});
		const result = checkCommitSubjects({
			exec,
			baseRef: "origin/main",
			headRef: "HEAD",
		});
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /2 commit/);
	});

	it("lints an empty subject rather than reading it as an empty range", () => {
		// `git commit --allow-empty-message` yields a commit whose subject is the
		// empty string. Splitting the log on newlines drops that record, so the
		// range looks empty and the run reports SKIP — a commit that fails every
		// rule passes by disappearing.
		const { exec, calls } = fakeExec({
			"git log": { out: logOutput(["feat(cli): a", ""]) },
		});
		const result = checkCommitSubjects({
			exec,
			baseRef: "origin/main",
			headRef: "HEAD",
		});
		// The record separator is the fix: asking for %s alone makes an empty
		// subject indistinguishable from the blank line between records, and a
		// behavioural assertion alone would pass for the wrong reason, because a
		// NUL left in the subject also breaks the Conventional Commits pattern.
		const logCall = calls.find((c) => c.startsWith("git log"));
		assert.ok(
			logCall?.includes("--format=%h%x09%s"),
			`expected the sha-anchored record format in the log call, got: ${logCall}`,
		);
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /Conventional/);
	});

	it("FAILs on an offending subject and names it with its reason", () => {
		const { exec } = fakeExec({
			"git log": { out: logOutput(["feat(cli): ok", "add a thing"]) },
		});
		const result = checkCommitSubjects({
			exec,
			baseRef: "origin/main",
			headRef: "HEAD",
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /add a thing/);
		assert.match(result.detail, /Conventional/);
	});
});
