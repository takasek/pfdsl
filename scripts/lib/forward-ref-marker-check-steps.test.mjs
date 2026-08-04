import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runForwardRefMarkerCheck } from "./forward-ref-marker-check-steps.mjs";

describe("runForwardRefMarkerCheck", () => {
	it("uses listFiles when no files are given on argv", () => {
		const calls = [];
		const result = runForwardRefMarkerCheck({
			args: [],
			listFiles: () => {
				calls.push("listFiles");
				return [];
			},
			readFile: () => "",
		});
		assert.deepEqual(calls, ["listFiles"]);
		assert.deepEqual(result.lines, [
			"check-forward-ref-markers: no resolved forward-ref markers found",
		]);
	});

	it("uses the given argv files instead of listFiles", () => {
		const listFilesCalls = [];
		const readCalls = [];
		runForwardRefMarkerCheck({
			args: ["a.md", "b.md"],
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
		assert.deepEqual(readCalls, ["a.md", "b.md"]);
	});

	it("reports no resolved markers for an empty file list", () => {
		const result = runForwardRefMarkerCheck({
			args: [],
			listFiles: () => [],
			readFile: () => "",
		});
		assert.deepEqual(result.lines, [
			"check-forward-ref-markers: no resolved forward-ref markers found",
		]);
	});

	it("reports no resolved markers when a forward-ref has no matching implements marker", () => {
		const texts = { "a.md": "planned: [[SPEC_foo?]] later" };
		const result = runForwardRefMarkerCheck({
			args: ["a.md"],
			listFiles: () => [],
			readFile: (file) => texts[file],
		});
		assert.deepEqual(result.lines, [
			"check-forward-ref-markers: no resolved forward-ref markers found",
		]);
	});

	it("reports a resolved marker found across multiple files, with the header and detail as separate lines", () => {
		const texts = {
			"a.md": "planned: [[SPEC_foo?]] later",
			"b.md": "## Heading (SPEC_foo)",
		};
		const result = runForwardRefMarkerCheck({
			args: ["a.md", "b.md"],
			listFiles: () => [],
			readFile: (file) => texts[file],
		});
		assert.equal(result.lines.length, 2);
		assert.match(
			result.lines[0],
			/^check-forward-ref-markers: 1 forward-ref marker\(s\) likely resolved — confirm and update the referenced text:\n$/,
		);
		assert.match(
			result.lines[1],
			/id "SPEC_foo": forward-ref at a\.md:1 <- implements at b\.md:1/,
		);
	});
});
