import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refineNativeWorktreeRelation } from "./native-worktree-owner.mjs";

const targetRoot = "/repo/作業\nspace";
const start = "Tue Oct  6 05:03:33 2026";
const lock = `claude session topic (pid 123 start ${start})`;
const listing = `worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree ${targetRoot}\0HEAD abc\0branch refs/heads/topic\0locked ${lock}\0\0`;

function claude(overrides = {}) {
	return {
		targetRoot,
		payload: { session_id: "claude-session" },
		environment: { CLAUDE_PROJECT_DIR: "/repo", PATH: "/bin" },
		parentPid: 123,
		execGit: () => ({ ok: true, out: listing }),
		execProcess: () => ({ ok: true, out: `${start}\n` }),
		...overrides,
	};
}
function codex(overrides = {}) {
	return {
		targetRoot,
		payload: { session_id: "native-thread" },
		environment: { PATH: "/bin", CODEX_THREAD_ID: "wrong" },
		execGit: () => ({
			ok: true,
			out: "/repo/.git/worktrees/topic/codex-thread.json\n",
		}),
		readMetadata: () =>
			JSON.stringify({ version: 1, ownerThreadId: "native-thread" }),
		...overrides,
	};
}

describe("native worktree owner", () => {
	it("refines a Claude sibling using its direct parent and UTC start, preserving NUL paths", () => {
		assert.equal(refineNativeWorktreeRelation("sibling", claude()), "own");
	});
	it("does not use a more distant owning ancestor for a nested session", () => {
		assert.equal(
			refineNativeWorktreeRelation("sibling", claude({ parentPid: 456 })),
			"sibling",
		);
	});
	it("keeps an agent worktree sibling even when its lock PID and start match the direct parent", () => {
		assert.equal(
			refineNativeWorktreeRelation(
				"sibling",
				claude({
					execGit: () => ({
						ok: true,
						out: listing.replace("claude session topic", "claude agent topic"),
					}),
				}),
			),
			"sibling",
		);
	});
	it("keeps sibling for missing, broken, stale or unreadable Claude evidence", () => {
		for (const options of [
			{ execGit: () => ({ ok: false, out: "failed" }) },
			{
				execGit: () => ({
					ok: true,
					out: listing.replace(`locked ${lock}\0`, ""),
				}),
			},
			{
				execGit: () => ({
					ok: true,
					out: listing.replace("pid 123", "pid unknown"),
				}),
			},
			{ execProcess: () => ({ ok: false, out: "failed" }) },
			{ execProcess: () => ({ ok: true, out: "Tue Oct 6 05:03:34 2026" }) },
			{
				execProcess: () => {
					throw new Error("unavailable");
				},
			},
		])
			assert.equal(
				refineNativeWorktreeRelation("sibling", claude(options)),
				"sibling",
			);
	});
	it("uses only the matching worktree record", () => {
		assert.equal(
			refineNativeWorktreeRelation(
				"sibling",
				claude({ targetRoot: "/repo/other" }),
			),
			"sibling",
		);
	});
	it("matches Codex native hook identity rather than shell identity", () => {
		assert.equal(refineNativeWorktreeRelation("sibling", codex()), "own");
		assert.equal(
			refineNativeWorktreeRelation(
				"sibling",
				codex({
					payload: { session_id: "other" },
					environment: { CODEX_THREAD_ID: "native-thread" },
				}),
			),
			"sibling",
		);
	});
	it("keeps sibling for absent, invalid, unknown or mismatched metadata", () => {
		for (const value of [
			"{",
			"null",
			"[]",
			'{"version":2,"ownerThreadId":"native-thread"}',
			'{"version":1,"ownerThreadId":""}',
			'{"version":1,"ownerThreadId":"other"}',
		]) {
			assert.equal(
				refineNativeWorktreeRelation(
					"sibling",
					codex({ readMetadata: () => value }),
				),
				"sibling",
			);
		}
		for (const options of [
			{ payload: {} },
			{ payload: { session_id: " " } },
			{ execGit: () => ({ ok: false, out: "failure" }) },
			{ execGit: () => ({ ok: true, out: "" }) },
			{
				readMetadata: () => {
					throw new Error("unreadable");
				},
			},
		])
			assert.equal(
				refineNativeWorktreeRelation("sibling", codex(options)),
				"sibling",
			);
	});
	it("never probes own, foreign or unknown targets", () => {
		for (const relation of ["own", "foreign", "unknown"]) {
			assert.equal(
				refineNativeWorktreeRelation(
					relation,
					codex({
						execGit: () => {
							throw new Error("must not probe");
						},
					}),
				),
				relation,
			);
		}
	});
	it("sanitizes Git identity probes and fixes ps locale/timezone without mutating the environment", () => {
		const environment = {
			CLAUDE_PROJECT_DIR: "/repo",
			GIT_DIR: "/wrong",
			GIT_COMMON_DIR: "/wrong",
			GIT_INDEX_FILE: "/wrong",
			TZ: "Asia/Tokyo",
			LC_ALL: "ja_JP",
		};
		const calls = [];
		assert.equal(
			refineNativeWorktreeRelation(
				"sibling",
				claude({
					environment,
					execGit: (args, opts) => {
						calls.push([args, opts]);
						return { ok: true, out: listing };
					},
					execProcess: (file, args, opts) => {
						calls.push([file, args, opts]);
						return { ok: true, out: start };
					},
				}),
			),
			"own",
		);
		assert.deepEqual(calls[0][0], ["worktree", "list", "--porcelain", "-z"]);
		for (const key of ["GIT_DIR", "GIT_COMMON_DIR", "GIT_INDEX_FILE"])
			assert.equal(key in calls[0][1].env, false);
		assert.deepEqual(calls[1].slice(0, 2), [
			"ps",
			["-o", "lstart=", "-p", "123"],
		]);
		assert.equal(calls[1][2].env.TZ, "UTC");
		assert.equal(calls[1][2].env.LC_ALL, "C");
		assert.equal(environment.GIT_DIR, "/wrong");
		assert.equal(environment.TZ, "Asia/Tokyo");
	});
	it("resolves fresh Codex evidence on every operation and sanitizes the target lookup", () => {
		let owner = "native-thread";
		const options = codex({
			environment: { GIT_DIR: "/wrong" },
			execGit: (args, opts) => {
				assert.deepEqual(args, [
					"rev-parse",
					"--git-path",
					"codex-thread.json",
				]);
				assert.equal("GIT_DIR" in opts.env, false);
				return {
					ok: true,
					out: "/repo/.git/worktrees/topic/codex-thread.json\n",
				};
			},
			readMetadata: () => JSON.stringify({ version: 1, ownerThreadId: owner }),
		});
		assert.equal(refineNativeWorktreeRelation("sibling", options), "own");
		owner = "other";
		assert.equal(refineNativeWorktreeRelation("sibling", options), "sibling");
	});
});
