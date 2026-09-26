import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkCommitSubjects } from "./commit-subjects.mjs";
import {
	analyzeAdoptedPfdsl,
	checkDocsStep,
	collectCycleWindow,
	collectSizeDeltas,
	commitSubjectStep,
	deletedFilesSince,
	firstCommitAuthorDate,
	formatCycleWindowReport,
	genPluginIdentityStep,
	outputArtifactStatusStep,
	triggerPathsSince,
	wipTransitionStep,
} from "./gate-check-steps.mjs";
import { genPluginDriftPathspecs } from "./gen-plugin-outputs.mjs";

/**
 * A stand-in for the real subprocess runner. `responses` maps a command line
 * ("git diff --quiet") to what it returns; anything unlisted succeeds with no
 * output, and every call is recorded so a test can assert what ran.
 * @param {Record<string, {ok?: boolean, out?: string}>} responses
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

const ROADMAP = ".pfdsl/roadmap.pfdsl";
describe("genPluginIdentityStep", () => {
	it("skips when no skill, plugin or install-source path changed", () => {
		const { exec, calls } = fakeExec();
		const result = genPluginIdentityStep({
			exec,
			node: exec,
			triggerPaths: ["packages/core/src/graph.ts"],
		});
		assert.equal(result.status, "SKIP");
		assert.match(result.detail, /no skill\/plugin\/install-source changes/);
		assert.deepEqual(calls, [], "nothing should run when the step is skipped");
	});

	it("passes when regeneration leaves both output trees unchanged", () => {
		const { exec, calls } = fakeExec();
		const result = genPluginIdentityStep({
			exec,
			node: exec,
			triggerPaths: [".claude/skills/pfd-ops/SKILL.md"],
		});
		assert.equal(result.status, "PASS");
		assert.ok(calls.some((c) => c.includes("gen-plugin.mjs")));
		assert.ok(
			calls.some((c) => c.startsWith("scripts/check-generated-drift.mjs")),
		);
	});

	it("diffs every surface of the output contract, not only plugin/ and install/", () => {
		const { exec, calls } = fakeExec();
		genPluginIdentityStep({
			exec,
			node: ([script, ...args]) => exec(script, args),
			triggerPaths: [".claude/skills/pfd-ops/SKILL.md"],
		});
		assert.deepEqual(
			calls.filter((c) => c.startsWith("scripts/check-generated-drift.mjs")),
			[
				[
					"scripts/check-generated-drift.mjs",
					"--",
					...genPluginDriftPathspecs("terminal"),
				].join(" "),
			],
		);
		for (const surface of ["CLAUDE.md", "AGENTS.md", ".codex", "generated"]) {
			assert.ok(
				genPluginDriftPathspecs("terminal").includes(surface),
				`${surface} missing from the terminal set`,
			);
		}
	});

	it("fails when regeneration produces a diff in the generated trees", () => {
		const { exec } = fakeExec({
			"scripts/check-generated-drift.mjs": { ok: false },
		});
		const result = genPluginIdentityStep({
			exec,
			node: exec,
			triggerPaths: [".claude/skills/pfd-ops/SKILL.md"],
		});
		assert.equal(result.status, "FAIL");
	});

	it("fails when the generator itself fails, without checking generated drift", () => {
		const { exec, calls } = fakeExec();
		const node = () => ({ ok: false, out: "boom" });
		const result = genPluginIdentityStep({
			exec,
			node,
			triggerPaths: [".claude/skills/pfd-ops/SKILL.md"],
		});
		assert.equal(result.status, "FAIL");
		assert.deepEqual(
			calls.filter((c) => c.startsWith("scripts/check-generated-drift.mjs")),
			[],
		);
	});

	it("runs for an install-source change, which the plugin trigger alone does not match", () => {
		const { exec, calls } = fakeExec();
		genPluginIdentityStep({
			exec,
			node: exec,
			triggerPaths: ["scripts/pfdsl/lib/gh-exec.mjs"],
		});
		assert.ok(calls.some((c) => c.includes("gen-plugin.mjs")));
	});
});

describe("triggerPathsSince", () => {
	it("keeps deletions and reports a move under both of its paths", () => {
		const { exec, calls } = fakeExec({
			"git diff": { out: "hooks/gone.mjs\0hooks/old.mjs\0docs/new.mjs\0" },
		});
		const result = triggerPathsSince({ exec, base: "main" });
		assert.deepEqual(result, {
			ok: true,
			files: ["hooks/gone.mjs", "hooks/old.mjs", "docs/new.mjs"],
		});
		assert.deepEqual(calls, [
			"git diff --no-renames --name-only -z origin/main...HEAD",
		]);
	});

	it("reports a failed diff instead of an empty trigger set", () => {
		const { exec } = fakeExec({ "git diff": { ok: false, out: "bad ref\n" } });
		assert.deepEqual(triggerPathsSince({ exec, base: "main" }), {
			ok: false,
			files: [],
			error: "bad ref",
		});
	});
});

describe("outputArtifactStatusStep", () => {
	const wipThenDone = (key) => ({
		before: `artifact:\n  ${key}:\n    status: wip\n`,
		after: `artifact:\n  ${key}:\n    status: done\n`,
	});

	it("skips on an explicit --no-artifact declaration", () => {
		const { exec, calls } = fakeExec();
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			noArtifact: true,
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "SKIP");
		assert.deepEqual(calls, []);
	});

	it("skips when neither an artifact key nor a roadmap change is present", () => {
		const { exec } = fakeExec();
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			changedFiles: ["packages/core/src/graph.ts"],
		});
		assert.equal(result.status, "SKIP");
	});

	it("passes when the named artifact's status changed between base and HEAD", () => {
		const { before, after } = wipThenDone("spec_v1");
		const { exec } = fakeExec({
			"git show origin/main:": { out: before },
			"git show HEAD:": { out: after },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
	});

	it("fails when a different artifact moved but the named one did not", () => {
		const { exec } = fakeExec({
			"git show origin/main:": {
				out: "artifact:\n  other:\n    status: wip\n",
			},
			"git show HEAD:": { out: "artifact:\n  other:\n    status: done\n" },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /spec_v1/);
	});

	it("fails clearly when the roadmap cannot be read at either end", () => {
		const { exec } = fakeExec({ "git show origin/main:": { ok: false } });
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /could not read/);
	});

	it("falls back to a whole-file status diff when no artifact key was given", () => {
		const { exec, calls } = fakeExec({
			"git diff origin/main...HEAD": {
				out: "-    status: todo\n+    status: wip\n",
			},
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
		assert.ok(calls.some((c) => c.startsWith("git diff origin/main...HEAD")));
	});

	it("fails the fallback when the roadmap changed for some other reason", () => {
		const { exec } = fakeExec({
			"git diff origin/main...HEAD": { out: "-  label: old\n+  label: new\n" },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
	});

	it("fails when git cannot produce the fallback diff", () => {
		const { exec } = fakeExec({
			"git diff origin/main...HEAD": { ok: false, out: "fatal: bad revision" },
		});
		const result = outputArtifactStatusStep({
			exec,
			base: "main",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /bad revision/);
	});
});

describe("wipTransitionStep", () => {
	it("skips on an explicit --no-artifact declaration", () => {
		const { exec, calls } = fakeExec();
		const result = wipTransitionStep({
			exec,
			base: "main",
			noArtifact: true,
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "SKIP");
		assert.deepEqual(calls, []);
	});

	it("skips when the roadmap is untouched", () => {
		const { exec } = fakeExec();
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: ["README.md"],
		});
		assert.equal(result.status, "SKIP");
	});

	it("passes when some commit's snapshot shows the artifact at wip", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { out: "sha1\nsha2\n" },
			"git show sha1:": { out: "artifact:\n  spec_v1:\n    status: wip\n" },
			"git show sha2:": { out: "artifact:\n  spec_v1:\n    status: done\n" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /spec_v1/);
	});

	it("fails when the artifact went straight to done in every snapshot", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { out: "sha1\n" },
			"git show sha1:": { out: "artifact:\n  spec_v1:\n    status: done\n" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /spec_v1/);
	});

	it("says the check is presence-only when no artifact key narrows it", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { out: "sha1\n" },
			"git show sha1:": { out: "artifact:\n  anything:\n    status: wip\n" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
		assert.match(result.detail, /presence-only/);
	});

	it("ignores a commit whose snapshot cannot be read rather than failing on it", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { out: "gone\nsha2\n" },
			"git show gone:": { ok: false, out: "fatal: bad object" },
			"git show sha2:": { out: "artifact:\n  spec_v1:\n    status: wip\n" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "PASS");
	});

	it("fails when the commit list itself cannot be produced", () => {
		const { exec } = fakeExec({
			"git log --format=%H": { ok: false, out: "fatal: bad revision" },
		});
		const result = wipTransitionStep({
			exec,
			base: "main",
			artifactKey: "spec_v1",
			changedFiles: [ROADMAP],
		});
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /bad revision/);
	});
});

describe("collectSizeDeltas", () => {
	it("measures tracked paths only", () => {
		const { exec, calls } = fakeExec({
			"git show origin/main:.pfdsl/bindings/x.pfdsl": { out: "aa\n" },
			"git show HEAD:.pfdsl/bindings/x.pfdsl": { out: "aaaaaa\n" },
		});
		const deltas = collectSizeDeltas({
			exec,
			base: "main",
			changedFiles: [".pfdsl/bindings/x.pfdsl", "packages/core/src/graph.ts"],
		});
		assert.deepEqual(deltas, [
			{
				path: ".pfdsl/bindings/x.pfdsl",
				beforeBytes: 3,
				afterBytes: 7,
				beforeLines: 2,
				afterLines: 2,
			},
		]);
		assert.ok(!calls.some((c) => c.includes("graph.ts")));
	});

	it("treats a new tracked file (no origin/base copy) as growth from zero", () => {
		const { exec } = fakeExec({
			"git show origin/main:.pfdsl/bindings/new.pfdsl": {
				ok: false,
				out: "fatal: does not exist",
			},
			"git show HEAD:.pfdsl/bindings/new.pfdsl": { out: "hello\n" },
		});
		const deltas = collectSizeDeltas({
			exec,
			base: "main",
			changedFiles: [".pfdsl/bindings/new.pfdsl"],
		});
		assert.equal(deltas[0].beforeBytes, 0);
		assert.equal(deltas[0].afterBytes, 6);
	});
});

describe("commitSubjectStep", () => {
	// The verdict itself belongs to checkCommitSubjects, which has its own
	// tests. What is only true here is the mapping from a base branch name to
	// the refs that function takes, and that the row comes back untouched.
	const log = (...subjects) =>
		subjects.map((s, i) => `sha${i}\t${s}\n`).join("");

	it("asks for origin/<base>..HEAD with the shared range options", () => {
		const { exec, calls } = fakeExec({
			"git log": { out: log("feat(cli): a") },
		});
		commitSubjectStep({ exec, base: "release" });
		const logCall = calls.find((c) => c.startsWith("git log"));
		// Exact, not a set of substring checks. The options are asserted here
		// rather than only in the shared function's own tests because
		// re-inlining the old body in this step would leave those green while
		// the gate and CI went back to judging different things — and a
		// substring assertion would still pass if a traversal-narrowing option
		// such as --first-parent were added, which drops the side parent's
		// commits from the range.
		assert.deepEqual(logCall?.split(" ").sort(), [
			"--format=%h%x09%s",
			"--no-merges",
			"git",
			"log",
			"origin/release..HEAD",
		]);
	});

	it("delegates to the shared checker rather than holding its own copy", () => {
		/** @type {unknown[]} */
		const seen = [];
		const row = { name: "commit subject lint", status: "PASS" };
		const result = commitSubjectStep({
			exec: () => ({ ok: true, out: "" }),
			base: "main",
			check: (args) => {
				seen.push(args);
				return row;
			},
		});
		assert.equal(seen.length, 1);
		assert.deepEqual(
			{ baseRef: seen[0].baseRef, headRef: seen[0].headRef },
			{ baseRef: "origin/main", headRef: "HEAD" },
		);
		// Identity, not deep equality: an inlined copy would return a row that
		// merely looks the same.
		assert.equal(result, row);
	});

	it("gets the same verdict as the shared checker on the default path", () => {
		// The spy above only proves the injected path. What production runs is
		// the default binding, and the way it goes stale is a fix landing in
		// checkCommitSubjects that a copy here never gets — so the case is one
		// whose answer depends on the parser rather than on the argv: a lone
		// empty subject is FAIL when each record is anchored by its sha and
		// SKIP under a plain newline split.
		// A table rather than one case: a copy of today's logic agrees on any
		// single input, so the wider the set the smaller the window in which a
		// stale default still looks right.
		const outputs = [
			log(""),
			log(" feat(cli): indented"),
			log("feat(cli): a", ""),
			log("feat(cli): a", "fix(cli): b"),
			log("add a thing"),
			// Shaped like a Conventional Commit but not one of the allowed
			// types: a stale clone carrying a broader matcher agrees with the
			// shared checker on every subject above and disagrees here.
			log("wip: something"),
			log("feat!: drop a flag"),
			log("fix(cli): 直す"),
			"",
		];
		for (const out of outputs) {
			const log = { "git log": { out } };
			const viaStep = commitSubjectStep({
				exec: fakeExec(log).exec,
				base: "main",
			});
			const direct = checkCommitSubjects({
				exec: fakeExec(log).exec,
				baseRef: "origin/main",
				headRef: "HEAD",
			});
			assert.deepEqual(viaStep, direct, `disagreed on ${JSON.stringify(out)}`);
		}
	});

	it("returns the shared check's row unchanged", () => {
		const { exec } = fakeExec({
			"git log": { out: log("feat(cli): a", "add a thing") },
		});
		const result = commitSubjectStep({ exec, base: "main" });
		assert.equal(result.name, "commit subject lint");
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /add a thing/);
	});
});

describe("checkDocsStep", () => {
	it("runs the whole check-docs target rather than one migrated check", () => {
		const { exec, calls } = fakeExec();
		const result = checkDocsStep({ exec });
		assert.equal(result.status, "PASS");
		assert.ok(calls.some((c) => c === "make check-docs"));
	});

	it("FAILs and reports the tail of the output when a check inside the target fails", () => {
		const { exec } = fakeExec({
			"make check-docs": {
				ok: false,
				out: "check-distributed-prose: content an adopting repo cannot resolve:\n  a.md:8: [issue-ref] bare issue reference #716",
			},
		});
		const result = checkDocsStep({ exec });
		assert.equal(result.status, "FAIL");
		assert.match(result.detail, /issue-ref/);
	});
});

describe("firstCommitAuthorDate", () => {
	it("returns the oldest commit's author date", () => {
		const { exec, calls } = fakeExec({
			"git log --format=%aI --reverse origin/main..HEAD": {
				out: "2026-08-11T00:06:33+09:00\n2026-08-11T00:09:30+09:00\n",
			},
		});
		assert.deepEqual(firstCommitAuthorDate({ exec, base: "main" }), {
			ok: true,
			iso: "2026-08-11T00:06:33+09:00",
		});
		assert.ok(calls.some((c) => c.includes("--reverse")));
	});

	it("reports an empty range as ok with no date, not as a failure", () => {
		const { exec } = fakeExec({ "git log --format=%aI": { out: "" } });
		assert.deepEqual(firstCommitAuthorDate({ exec, base: "main" }), {
			ok: true,
			iso: null,
		});
	});

	it("reports a failed lookup as not ok, which is not the same as no commits", () => {
		const { exec } = fakeExec({
			"git log --format=%aI": { ok: false, out: "fatal: bad revision" },
		});
		assert.deepEqual(firstCommitAuthorDate({ exec, base: "main" }), {
			ok: false,
			iso: null,
		});
	});
});

// #834: report material, not a verdict. The window is the union of (1) base
// commits this tree currently lacks and (2) base commits that landed at/after
// the branch's first commit — (2) is what survives a rebase, since after one
// those same commits are ancestors of HEAD while still being reachable from
// origin/<base> with a committer date past the branch's start.
describe("collectCycleWindow", () => {
	it("unions the lagged list with the since-branch-start list", () => {
		const { exec, calls } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				out: "aaa1111\tfix: b\n",
			},
			"git log --format=%aI --reverse origin/main..HEAD": {
				out: "2026-08-01T00:00:00+09:00\n2026-08-02T00:00:00+09:00\n2026-08-03T00:00:00+09:00\n",
			},
			"git log --format=%h%x09%s --since=": { out: "bbb2222\tfeat: c\n" },
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [
			{ sha: "aaa1111", subject: "fix: b" },
			{ sha: "bbb2222", subject: "feat: c" },
		]);
		assert.ok(
			calls.some((c) =>
				c.includes("--since=2026-08-01T00:00:00+09:00 origin/main"),
			),
			"measures from the branch's oldest commit, the last line git log prints",
		);
	});

	// Measured on this branch: `git rebase origin/main` rewrote every commit's
	// committer date to the rebase moment while leaving author dates alone. An
	// anchor read from %cI therefore jumps forward to "now" on the very run this
	// half exists for, and the window collapses to (none) — the reading #834
	// exists to stop, arrived at by a different road.
	it("anchors on the first commit's author date, which a rebase preserves", () => {
		const { exec, calls } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": { out: "" },
			"git log --format=%aI --reverse origin/main..HEAD": {
				out: "2026-08-11T00:06:33+09:00\n2026-08-11T00:09:30+09:00\n",
			},
			"git log --format=%h%x09%s --since=": { out: "bbb2222\tfeat: c\n" },
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [{ sha: "bbb2222", subject: "feat: c" }]);
		assert.ok(
			calls.some((c) =>
				c.includes("--since=2026-08-11T00:06:33+09:00 origin/main"),
			),
			"measures from the oldest commit's author date, not the newest",
		);
		assert.ok(
			!calls.some((c) => c.includes("--format=%cI")),
			"committer dates are rewritten by the rebase this half is measuring across",
		);
	});

	it("skips the since-branch-start half entirely when the branch has no commits yet", () => {
		const { exec, calls } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				out: "aaa1111\tfix: b\n",
			},
			"git log --format=%aI --reverse origin/main..HEAD": { out: "" },
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [{ sha: "aaa1111", subject: "fix: b" }]);
		assert.equal(result.note, undefined);
		assert.ok(!calls.some((c) => c.includes("--since=")));
	});

	it("reports failure of the base-commits-this-tree-lacks query as ok: false", () => {
		const { exec } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				ok: false,
				out: "fatal: bad revision",
			},
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, false);
		assert.equal(result.error, "fatal: bad revision");
	});

	it("keeps part (1) when reading the branch's commit dates fails, noting the gap", () => {
		const { exec } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				out: "aaa1111\tfix: b\n",
			},
			"git log --format=%aI --reverse origin/main..HEAD": {
				ok: false,
				out: "fatal: bad object",
			},
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [{ sha: "aaa1111", subject: "fix: b" }]);
		assert.match(result.note ?? "", /could not/);
	});

	it("keeps part (1) when the since-branch-start query fails, noting the gap", () => {
		const { exec } = fakeExec({
			"git log --format=%h%x09%s HEAD..origin/main": {
				out: "aaa1111\tfix: b\n",
			},
			"git log --format=%aI --reverse origin/main..HEAD": {
				out: "2026-08-01T00:00:00+09:00\n",
			},
			"git log --format=%h%x09%s --since=": {
				ok: false,
				out: "fatal: bad revision",
			},
		});
		const result = collectCycleWindow({ exec, base: "main" });
		assert.equal(result.ok, true);
		assert.deepEqual(result.entries, [{ sha: "aaa1111", subject: "fix: b" }]);
		assert.match(result.note ?? "", /could not/);
	});
});

describe("formatCycleWindowReport", () => {
	it("does not report a confirmed empty window when fetch failed", () => {
		const lines = formatCycleWindowReport({
			fetchResult: {
				ok: false,
				out: "fatal: could not open FETCH_HEAD",
			},
			window: { ok: true, entries: [] },
		});
		assert.deepEqual(lines, [
			"origin freshness could not be established: fatal: could not open FETCH_HEAD",
		]);
	});

	it("preserves the confirmed window when fetch succeeded", () => {
		const lines = formatCycleWindowReport({
			fetchResult: { ok: true, out: "" },
			window: {
				ok: true,
				entries: [{ sha: "aaa1111", subject: "fix: base" }],
			},
		});
		assert.deepEqual(lines, ["aaa1111 fix: base"]);
		assert.deepEqual(
			formatCycleWindowReport({
				fetchResult: { ok: true, out: "" },
				window: { ok: true, entries: [] },
			}),
			["(none)"],
		);
	});

	it("labels entries from the existing origin ref as unverified after fetch failure", () => {
		const lines = formatCycleWindowReport({
			fetchResult: { ok: false, out: "fatal: fetch denied" },
			window: {
				ok: true,
				entries: [{ sha: "aaa1111", subject: "fix: base" }],
			},
		});
		assert.deepEqual(lines, [
			"origin freshness could not be established: fatal: fetch denied",
			"unverified entries from the existing origin ref:",
			"  aaa1111 fix: base",
		]);
	});
});

describe("analyzeAdoptedPfdsl", () => {
	const deps = (overrides = {}) => ({
		readdirSync: () => ["workflow.pfdsl", "roadmap.pfdsl", "roadmap.md"],
		readFile: (file) => `text of ${file}`,
		analyze: (text) => ({ frontmatter: { title: text } }),
		...overrides,
	});

	it("parses every .pfdsl in the directory, in a stable order, ignoring other files", () => {
		const { analyzed, unreadable } = analyzeAdoptedPfdsl(deps());
		assert.deepEqual(
			analyzed.map((a) => a.file),
			[".pfdsl/roadmap.pfdsl", ".pfdsl/workflow.pfdsl"],
		);
		assert.deepEqual(unreadable, []);
	});

	it("passes the file's text through analyze and keeps the frontmatter", () => {
		const { analyzed } = analyzeAdoptedPfdsl(deps());
		assert.equal(analyzed[0].frontmatter.title, "text of .pfdsl/roadmap.pfdsl");
	});

	// One unparsable file must not cost the report every other file's locations:
	// the block this feeds is material, and a partial reading is worth more than
	// none as long as the gap is named.
	it("isolates a failing file, naming it, and keeps the rest", () => {
		const { analyzed, unreadable } = analyzeAdoptedPfdsl(
			deps({
				analyze: (text) => {
					if (text.includes("workflow")) throw new Error("bad frontmatter");
					return { frontmatter: {} };
				},
			}),
		);
		assert.deepEqual(
			analyzed.map((a) => a.file),
			[".pfdsl/roadmap.pfdsl"],
		);
		assert.deepEqual(unreadable, [".pfdsl/workflow.pfdsl: bad frontmatter"]);
	});
});

describe("deletedFilesSince", () => {
	it("returns the branch's deleted paths, three-dot against the base", () => {
		const { exec, calls } = fakeExec({
			"git diff --diff-filter=D": { out: "docs/samples/gone.svg\n" },
		});
		assert.deepEqual(deletedFilesSince({ exec, base: "main" }), [
			"docs/samples/gone.svg",
		]);
		assert.ok(
			calls.some((c) =>
				c.startsWith("git diff --diff-filter=D --name-only origin/main...HEAD"),
			),
		);
	});

	// The report this feeds is material; a git failure there costs the deleted
	// half of it, not the whole block.
	it("returns nothing rather than throwing when git fails", () => {
		const { exec } = fakeExec({ "git diff --diff-filter=D": { ok: false } });
		assert.deepEqual(deletedFilesSince({ exec, base: "main" }), []);
	});
});
