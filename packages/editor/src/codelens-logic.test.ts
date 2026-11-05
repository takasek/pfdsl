import { analyzeSource } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import { runHintsFromAnalysis } from "./codelens-logic.js";

function hints(lines: readonly string[]) {
	return runHintsFromAnalysis(analyzeSource(lines.join("\n")), lines);
}

describe("runHintsFromAnalysis", () => {
	it("anchors each semantic command at the end of its authored line", () => {
		const lines = [
			"---",
			"process:",
			"  build:",
			'    command: "make build"',
			"  test: {command: make test}",
			"---",
			"spec >> build -> out",
			"    command: make build",
		];
		expect(hints(lines)).toEqual([
			{ line: 3, column: lines[3]!.length, command: "make build" },
			{ line: 4, column: lines[4]!.length, command: "make test" },
		]);
	});
	it("ignores missing, empty and unrelated commands", () => {
		for (const lines of [["a >> p -> b"], ["---", "command: make", "---"]]) {
			expect(hints(lines)).toEqual([]);
		}
		expect(
			hints([
				"---",
				"process: {a: {}, b: {command: ''}, c: {command: make}}",
				"---",
			]),
		).toEqual([
			{
				line: 1,
				column: "process: {a: {}, b: {command: ''}, c: {command: make}}".length,
				command: "make",
			},
		]);
	});
	it("retains separate anchors for the same command declared twice", () => {
		expect(
			hints([
				"---",
				"process: {a: {command: make}, b: {command: make}}",
				"---",
			]),
		).toHaveLength(2);
	});
});
