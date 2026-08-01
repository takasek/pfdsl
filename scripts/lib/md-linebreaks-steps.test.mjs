import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runMdLinebreaksCheck } from "./md-linebreaks-steps.mjs";

describe("runMdLinebreaksCheck", () => {
	it("uses listFiles when no files are given on argv", () => {
		const calls = [];
		runMdLinebreaksCheck({
			args: [],
			listFiles: () => {
				calls.push("listFiles");
				return [];
			},
			readFile: () => "",
		});
		assert.deepEqual(calls, ["listFiles"]);
	});

	it("uses the given argv files instead of listFiles", () => {
		const listFilesCalls = [];
		const readCalls = [];
		runMdLinebreaksCheck({
			args: ["a.md"],
			listFiles: () => {
				listFilesCalls.push("listFiles");
				return ["should-not-be-used.md"];
			},
			readFile: (file) => {
				readCalls.push(file);
				return "";
			},
		});
		assert.deepEqual(listFilesCalls, []);
		assert.deepEqual(readCalls, ["a.md"]);
	});

	it("exits 0 with an OK message when there are no violations", () => {
		const result = runMdLinebreaksCheck({
			args: ["a.md"],
			listFiles: () => [],
			readFile: () => "prose\n続き。\n  次の行",
		});
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.messages, [{ stream: "log", text: "check-md-linebreaks: OK" }]);
	});

	it("exits 1 immediately when a file cannot be read, without a summary line", () => {
		const result = runMdLinebreaksCheck({
			args: ["missing.md"],
			listFiles: () => [],
			readFile: () => {
				throw new Error("ENOENT: no such file");
			},
		});
		assert.equal(result.exitCode, 1);
		assert.deepEqual(result.messages, [
			{ stream: "error", text: "Error reading missing.md: ENOENT: no such file" },
		]);
	});

	it("prints a 3-line violation block per hit and exits 1", () => {
		const result = runMdLinebreaksCheck({
			args: ["a.md"],
			listFiles: () => [],
			readFile: () => "prose\n続き\n  次の行",
		});
		assert.equal(result.exitCode, 1);
		assert.deepEqual(result.messages, [
			{ stream: "log", text: "a.md:3: mid-sentence line break" },
			{ stream: "log", text: "  prev: …続き" },
			{ stream: "log", text: "  cont: 次の行" },
			{ stream: "error", text: "\n1 violation(s) found." },
		]);
	});

	it("aggregates violations across multiple files into one total", () => {
		const texts = {
			"a.md": "prose\n続き\n  次の行",
			"b.md": "prose\n続き\n  次の行",
		};
		const result = runMdLinebreaksCheck({
			args: ["a.md", "b.md"],
			listFiles: () => [],
			readFile: (file) => texts[file],
		});
		assert.equal(result.exitCode, 1);
		assert.ok(result.messages.some((m) => m.text === "\n2 violation(s) found."));
	});
});
