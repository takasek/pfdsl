import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
	pinRevisionExec,
	readRevisionBlob,
	resolveReportRevision,
	revisionPfdReaders,
} from "./gate-report-revision.mjs";

const head = "1".repeat(40),
	baseTip = "2".repeat(40),
	mergeBase = "3".repeat(40);
describe("report revision", () => {
	it("resolves the head, base tip and PR comparison before reading report inputs", () => {
		const out = [head, baseTip, mergeBase];
		const calls = [];
		const revision = resolveReportRevision({
			base: "main",
			exec: (file, args) => {
				calls.push([file, args]);
				return { ok: true, out: out.shift() };
			},
		});
		assert.equal(revision.head, head);
		assert.equal(revision.baseTip, baseTip);
		assert.equal(revision.mergeBase, mergeBase);
		assert.deepEqual(calls[2], ["git", ["merge-base", baseTip, head]]);
	});
	it("pins ranges and blobs but does not rewrite path text or non-git arguments", () => {
		const calls = [];
		const exec = pinRevisionExec(
			(file, args) => {
				calls.push([file, args]);
				return { ok: true, out: "" };
			},
			{ head, baseTip, base: "main" },
		);
		exec("git", ["diff", "origin/main...HEAD", "--", "docs/HEAD.md"]);
		exec("git", ["show", "HEAD:.pfdsl/workflow.pfdsl"]);
		exec("node", ["HEAD"]);
		assert.deepEqual(calls, [
			["git", ["diff", `${baseTip}...${head}`, "--", "docs/HEAD.md"]],
			["git", ["show", `${head}:.pfdsl/workflow.pfdsl`]],
			["node", ["HEAD"]],
		]);
	});
	it("distinguishes verified absence, blob read failure and tree listing failure", () => {
		const absent = readRevisionBlob({
			exec: () => ({ ok: true, out: "" }),
			ref: head,
			path: "new.md",
		});
		assert.deepEqual(absent, { ok: true, exists: false, text: "" });
		for (const failureAt of ["ls-tree", "show"]) {
			const result = readRevisionBlob({
				exec: (_file, args) =>
					args[0] === failureAt
						? { ok: false, out: "permission denied" }
						: { ok: true, out: "new.md\0" },
				ref: head,
				path: "new.md",
			});
			assert.equal(result.ok, false);
			assert.match(result.error, /permission denied/);
		}
	});
	it("reads adopted model names and text from the fixed head, never the working tree", () => {
		const calls = [];
		const readers = revisionPfdReaders({
			exec: (_file, args) => {
				calls.push(args);
				return {
					ok: true,
					out:
						args[0] === "ls-tree"
							? "workflow.pfdsl\0roadmap.md\0"
							: "committed model",
				};
			},
			head,
		});
		assert.deepEqual(readers.readdirSync(".pfdsl"), [
			"workflow.pfdsl",
			"roadmap.md",
		]);
		assert.equal(readers.readFile(".pfdsl/workflow.pfdsl"), "committed model");
		assert.deepEqual(calls[1], ["show", `${head}:.pfdsl/workflow.pfdsl`]);
	});
	it("does not report an unresolved revision as a measurable snapshot", () => {
		assert.throws(
			() =>
				resolveReportRevision({
					base: "main",
					exec: () => ({ ok: false, out: "bad ref" }),
				}),
			/bad ref/,
		);
	});
	it("reads a literal filename containing Git pathspec characters", () => {
		const cwd = mkdtempSync(join(tmpdir(), "pfdsl-report-blob-"));
		try {
			const git = (args) =>
				execFileSync("git", args, { cwd, encoding: "utf8" });
			git(["init", "-q"]);
			writeFileSync(join(cwd, "[draft].md"), "literal content");
			git(["add", "."]);
			git([
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-qm",
				"test",
			]);
			const result = readRevisionBlob({
				ref: "HEAD",
				path: "[draft].md",
				exec: (_file, args) => ({ ok: true, out: git(args) }),
			});
			assert.deepEqual(result, {
				ok: true,
				exists: true,
				text: "literal content",
			});
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
