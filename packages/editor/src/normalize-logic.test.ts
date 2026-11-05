import { expect, it } from "vitest";
import * as editor from "./index.js";

it.each([
	["[b, a] >> p -> [z, y]\n", "a >> p\nb >> p\np -> y\np -> z\n"],
	[
		"input >> build -> output\noutput >>? build\n",
		"input >> build\noutput >>? build\nbuild -> output\n",
	],
	[
		'"日本語 入力" >> work -> "出力"\n',
		'"日本語 入力" >> work\nwork -> 出力\n',
	],
	["lonely\n", ""],
	["", ""],
])("returns the existing canonical edge text for %s", (source, expected) => {
	const model = editor.analyzeSnapshot(source);
	const before = structuredClone(model);
	expect(editor.computeNormalizedEdgesOutput(model)).toBe(expected);
	expect(model).toEqual(before);
});

it("blocks invalid authored source while allowing warning-only documents", () => {
	expect(
		editor.computeNormalizedEdgesOutput(editor.analyzeSnapshot("a >>")),
	).toBeNull();
	const model = editor.analyzeSnapshot(
		"---\nartifact:\n  b: {status: done}\n---\na >> p -> b\n",
	);
	expect(model.diagnostics.some((d) => d.severity === "warning")).toBe(true);
	expect(editor.computeNormalizedEdgesOutput(model)).toBe("a >> p\np -> b\n");
});
