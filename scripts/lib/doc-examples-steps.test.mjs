import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDocExamplesCheck } from "./doc-examples-steps.mjs";

describe("runDocExamplesCheck", () => {
	it("exits 0 with 'checked 0 block(s)' and 'OK' when there are no pfdsl blocks", () => {
		const result = runDocExamplesCheck({
			files: ["a.md"],
			readFile: () => "just prose",
			exec: () => {
				throw new Error("exec must not be called with no blocks");
			},
		});
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.messages, [
			{
				stream: "log",
				text: "check-doc-examples: checked 0 block(s) across 1 file(s)",
			},
			{ stream: "log", text: "check-doc-examples: OK" },
		]);
	});

	it("exits 1 immediately when a file cannot be read, without a summary line", () => {
		const result = runDocExamplesCheck({
			files: ["missing.md"],
			readFile: () => {
				throw new Error("ENOENT: no such file");
			},
			exec: () => ({ status: 0 }),
		});
		assert.equal(result.exitCode, 1);
		assert.deepEqual(result.messages, [
			{
				stream: "error",
				text: "Error reading missing.md: ENOENT: no such file",
			},
		]);
	});

	it("runs exec once per extracted block and counts them into the summary", () => {
		const calls = [];
		const result = runDocExamplesCheck({
			files: ["a.md"],
			readFile: () =>
				["```pfdsl", "a: {}", "```", "```pfdsl", "b: {}", "```"].join("\n"),
			exec: (block) => {
				calls.push(block.content);
				return { status: 0 };
			},
		});
		assert.deepEqual(calls, ["a: {}", "b: {}"]);
		assert.equal(result.exitCode, 0);
		assert.ok(
			result.messages.some((m) => m.text.includes("checked 2 block(s)")),
		);
	});

	it("counts a nonzero exec status as a failure and prints its stdout/stderr", () => {
		const result = runDocExamplesCheck({
			files: ["a.md"],
			readFile: () => ["```pfdsl", "broken", "```"].join("\n"),
			exec: () => ({
				status: 1,
				stdout: "diagnostic output",
				stderr: "stderr output",
			}),
		});
		assert.equal(result.exitCode, 1);
		assert.deepEqual(result.messages, [
			{ stream: "error", text: "a.md:1: pfdsl block check FAILED" },
			{ stream: "stdout", text: "diagnostic output" },
			{ stream: "stderr", text: "stderr output" },
			{
				stream: "log",
				text: "check-doc-examples: checked 1 block(s) across 1 file(s)",
			},
			{ stream: "error", text: "1 block(s) failed." },
		]);
	});

	it("omits empty stdout/stderr from the messages on failure", () => {
		const result = runDocExamplesCheck({
			files: ["a.md"],
			readFile: () => ["```pfdsl", "broken", "```"].join("\n"),
			exec: () => ({ status: 1, stdout: "", stderr: "" }),
		});
		assert.deepEqual(result.messages, [
			{ stream: "error", text: "a.md:1: pfdsl block check FAILED" },
			{
				stream: "log",
				text: "check-doc-examples: checked 1 block(s) across 1 file(s)",
			},
			{ stream: "error", text: "1 block(s) failed." },
		]);
	});

	it("aggregates blocks and failures across multiple files", () => {
		const texts = {
			"a.md": ["```pfdsl", "ok: {}", "```"].join("\n"),
			"b.md": ["```pfdsl", "broken", "```"].join("\n"),
		};
		const result = runDocExamplesCheck({
			files: ["a.md", "b.md"],
			readFile: (file) => texts[file],
			exec: (block) =>
				block.filePath === "b.md" ? { status: 1 } : { status: 0 },
		});
		assert.equal(result.exitCode, 1);
		assert.ok(
			result.messages.some((m) =>
				m.text.includes("checked 2 block(s) across 2 file(s)"),
			),
		);
		assert.ok(result.messages.some((m) => m.text === "1 block(s) failed."));
	});
});
