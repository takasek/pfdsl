import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	git,
	gitDiffNames,
	gitLsFiles,
	resolveGitRoots,
	run,
	tryGit,
	tryRun,
} from "./run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("run-exec", () => {
	it("resolves a linked worktree and its shared repository roots", () => {
		const calls = [];
		const roots = resolveGitRoots("/repo/.claude/worktrees/topic", {
			exec: (args, opts) => {
				calls.push([args, opts]);
				if (args.includes("--show-toplevel")) {
					return { ok: true, out: "/repo/.claude/worktrees/topic\n" };
				}
				return { ok: true, out: "../../../.git\n" };
			},
		});

		assert.deepEqual(roots, {
			worktreeRoot: "/repo/.claude/worktrees/topic",
			commonDir: "/repo/.git",
			mainRoot: "/repo",
		});
		assert.deepEqual(
			calls.map(([args, opts]) => [args, opts.cwd]),
			[
				[["rev-parse", "--show-toplevel"], "/repo/.claude/worktrees/topic"],
				[["rev-parse", "--git-common-dir"], "/repo/.claude/worktrees/topic"],
			],
		);
	});

	it("passes an argument containing shell metacharacters through verbatim", () => {
		const marker = resolve(tmpdir(), `run-exec-injection-${process.pid}`);
		rmSync(marker, { force: true });

		const result = tryGit(["rev-parse", `HEAD; touch ${marker}`], {
			cwd: root,
		});

		assert.equal(existsSync(marker), false, "the argument reached a shell");
		assert.equal(result.ok, false, "an unusable ref must fail");
	});

	it("does not split an argument on whitespace", () => {
		const result = tryRun("echo", ["one two"], { cwd: root });

		assert.equal(result.ok, true);
		assert.equal(result.out.trim(), "one two");
	});

	it("reports the exit status of a failed command instead of throwing", () => {
		const result = tryRun("git", ["rev-parse", "definitely-not-a-ref"], {
			cwd: root,
		});

		assert.equal(result.ok, false);
		assert.notEqual(result.status, 0);
		assert.ok(
			result.out.length > 0,
			"the reason must survive for the caller to print",
		);
	});

	it("returns stdout on success", () => {
		assert.match(
			git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).trim(),
			/\S/,
		);
	});

	it("forwards stdin to the command", () => {
		assert.match(run("cat", [], { cwd: root, input: "piped" }), /piped/);
	});

	it("throws on a non-zero exit so callers that need a hard failure get one", () => {
		assert.throws(() =>
			git(["rev-parse", "definitely-not-a-ref"], { cwd: root }),
		);
	});
});

describe("run-exec stderr handling", () => {
	it("carries the failure reason from stderr, where git writes it", () => {
		const result = tryRun("git", ["rev-parse", "definitely-not-a-ref"], {
			cwd: root,
		});

		assert.match(result.out, /definitely-not-a-ref|unknown revision|ambiguous/);
	});
});

describe("run-exec stderr routing", () => {
	it("leaves stderr inherited by default, as the callers relied on", () => {
		const result = tryRun(
			process.execPath,
			["-e", "process.stderr.write('x'); process.exit(1)"],
			{ cwd: root },
		);

		assert.equal(result.ok, false);
		assert.equal(result.status, 1);
		// Inherited, so nothing was captured for us to read back.
		assert.equal(typeof result.out, "string");
	});

	it("captures stderr when the caller asks, so a failing probe stays quiet", () => {
		const result = tryRun(
			process.execPath,
			["-e", "process.stderr.write('probe reason'); process.exit(1)"],
			{
				cwd: root,
				captureStderr: true,
			},
		);

		assert.equal(result.ok, false);
		assert.match(result.out, /probe reason/);
	});
});

describe("gitLsFiles", () => {
	it("asks for NUL separators and splits on them", () => {
		/** @type {string[][]} */
		const calls = [];
		const files = gitLsFiles(["*.md"], {
			cwd: "/repo",
			exec: (args, opts) => {
				calls.push(args);
				assert.equal(opts.cwd, "/repo");
				return "a.md\0名前.md\0";
			},
		});

		assert.deepEqual(calls, [["ls-files", "-z", "*.md"]]);
		assert.deepEqual(files, ["a.md", "名前.md"]);
	});

	it("returns nothing for an empty listing", () => {
		assert.deepEqual(
			gitLsFiles(["*.none"], { cwd: "/repo", exec: () => "" }),
			[],
		);
	});

	it("keeps a filename containing a newline in one piece", () => {
		assert.deepEqual(
			gitLsFiles(["*"], { cwd: "/repo", exec: () => "od\nd.md\0b.md\0" }),
			["od\nd.md", "b.md"],
		);
	});
});

describe("gitDiffNames", () => {
	it("asks for NUL separators and splits on them", () => {
		/** @type {string[][]} */
		const calls = [];
		const files = gitDiffNames(["--cached"], {
			cwd: "/repo",
			exec: (args, opts) => {
				calls.push(args);
				assert.equal(opts.cwd, "/repo");
				return "a.md\0名前.md\0";
			},
		});

		assert.deepEqual(calls, [["diff", "-z", "--name-only", "--cached"]]);
		assert.deepEqual(files, ["a.md", "名前.md"]);
	});

	it("returns nothing for an empty diff", () => {
		assert.deepEqual(
			gitDiffNames(["main", "HEAD"], { cwd: "/repo", exec: () => "" }),
			[],
		);
	});

	it("keeps a filename containing a newline in one piece", () => {
		assert.deepEqual(
			gitDiffNames(["main", "HEAD"], {
				cwd: "/repo",
				exec: () => "od\nd.md\0b.md\0",
			}),
			["od\nd.md", "b.md"],
		);
	});
});
