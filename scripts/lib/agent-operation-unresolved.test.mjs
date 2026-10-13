import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	recordUnresolvedDecision,
	summarizeUnresolvedRecords,
} from "./agent-operation-unresolved.mjs";

test("unresolved recording keeps only aggregate-safe fields under the Git common dir", () => {
	const root = mkdtempSync(
		fileURLToPath(
			new URL("../../node_modules/pfdsl-unresolved-", import.meta.url),
		),
	);
	try {
		const classified = {
			subject: "claude-parent",
			command: "/fixture/private",
			operations: [
				{
					classes: ["U"],
					subcommand: "gh api",
					executionPath: "/fixture/private",
					unresolvedReasons: ["unknown-option"],
					unknownOptions: ["--not-declared", "--bad=/fixture/private"],
				},
			],
		};
		const decision = {
			decision: "deny",
			operationClass: "U",
			reason: "private text",
		};
		recordUnresolvedDecision(
			classified,
			decision,
			{ sessionRoot: root },
			{
				now: () => new Date("2026-10-13T00:00:00.000Z"),
				probeGit: (args, { cwd }) => {
					assert.deepEqual(args, ["rev-parse", "--git-common-dir"]);
					assert.equal(cwd, root);
					return { ok: true, out: ".git\n" };
				},
			},
		);
		const text = readFileSync(
			join(root, ".git/pfdsl/agent-operation-unresolved.jsonl"),
			"utf8",
		);
		assert.deepEqual(JSON.parse(text), {
			at: "2026-10-13T00:00:00.000Z",
			subject: "claude-parent",
			subcommand: "gh api",
			reasons: ["unknown-option"],
			unknownOptions: ["--not-declared"],
		});
		assert.doesNotMatch(text, /fixture|private|executionPath|"command"/);
		const summary = summarizeUnresolvedRecords(`${text}${text}{bad\n`);
		assert.equal(summary.total, 2);
		assert.equal(summary.invalid, 1);
		assert.deepEqual(summary.reasons, { "unknown-option": 2 });
		assert.deepEqual(summary.options, { "--not-declared": 2 });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("recording failures are best effort and confirmed non-U decisions perform no IO", () => {
	const classified = {
		subject: "codex-parent",
		operations: [
			{
				classes: ["U"],
				subcommand: "git update-ref",
				unresolvedReasons: ["indirect-stdin"],
				unknownOptions: [],
			},
		],
	};
	const decision = { decision: "deny", operationClass: "U" };
	const before = structuredClone(decision);
	assert.doesNotThrow(() =>
		recordUnresolvedDecision(
			classified,
			decision,
			{ commonDir: "/fixture/common" },
			{
				makeDirectory: () => {
					throw new Error("fixture write failure");
				},
			},
		),
	);
	assert.deepEqual(decision, before);
	const noIO = () => {
		assert.fail("non-U decisions must not observe or write logs");
	};
	for (const result of [
		{ decision: "allow" },
		{ decision: "deny", operationClass: "P" },
	])
		recordUnresolvedDecision(
			classified,
			result,
			{},
			{ probeGit: noIO, append: noIO, makeDirectory: noIO },
		);
});
