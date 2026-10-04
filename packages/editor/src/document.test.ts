import { describe, expect, it } from "vitest";
import { analyzeSnapshot, preloadPresets, prepareDocument } from "./index.js";

describe("shared document pipeline", () => {
	it("derives presentation and diagnostics from the same dependency snapshot", () => {
		const model = analyzeSnapshot(
			"---\nextends: preset.yaml\n---\na >> p -> b\n",
		);
		let reads = 0;
		const result = prepareDocument(model, "/project/a.pfdsl", () => {
			reads++;
			return reads === 1
				? analyzeSnapshot("---\nstatusStyles: {done: {fillcolor: red}}\n---\n")
				: null;
		});
		expect(result.frontmatter?.statusStyles?.done?.fillcolor).toBe("red");
		expect(result.presetDiagnostics).toEqual([]);
		expect(reads).toBe(1);
	});
	it("uses the unsaved snapshot, preserving declaration ranges and inherited styles", async () => {
		const source =
			"---\nextends: preset.yaml\nartifact:\n  'status':\n    status: done\n---\nstatus >> p -> b\n";
		const model = analyzeSnapshot(source);
		const read = async (path: string) =>
			path === "/project/preset.yaml"
				? "statusStyles: {done: {fillcolor: red}}\n"
				: null;
		const load = await preloadPresets("/project/main.pfdsl", model, read);
		const result = prepareDocument(model, "/project/main.pfdsl", load);
		expect(
			result.model.sourceMap.declarations.find((d) => d.id === "status")?.range
				.start.line,
		).toBe(4);
		expect(result.frontmatter?.statusStyles?.done?.fillcolor).toBe("red");
		expect(result.message.type).toBe("render");
		if (result.message.type === "render")
			expect(result.message.dot).toContain('fillcolor="red"');
	});
	it("keeps entry diagnostics distinct from preset diagnostics and refuses a broken graph", async () => {
		const model = analyzeSnapshot(
			"---\nextends: missing.yaml\n---\na >> p -> b\n",
		);
		const load = await preloadPresets(
			"/project/a.pfdsl",
			model,
			async () => null,
		);
		const result = prepareDocument(model, "/project/a.pfdsl", load);
		expect(result.model.diagnostics).toEqual(model.diagnostics);
		expect(result.presetDiagnostics.some((d) => d.severity === "error")).toBe(
			true,
		);
		expect(
			prepareDocument(analyzeSnapshot("a >>"), null, () => null).message.type,
		).toBe("error");
	});
	it("terminates circular preset loading and retains the edited entry over disk contents", async () => {
		const model = analyzeSnapshot("---\nextends: b.pfdsl\n---\na >> p -> b\n");
		const paths: string[] = [];
		const load = await preloadPresets(
			"/project/a.pfdsl",
			model,
			async (path) => {
				paths.push(path);
				return "---\nextends: a.pfdsl\n---\n";
			},
		);
		expect(paths).toEqual(["/project/b.pfdsl"]);
		expect(load("/project/a.pfdsl")).toBe(model);
		expect(
			prepareDocument(model, "/project/a.pfdsl", load).presetDiagnostics.length,
		).toBeGreaterThan(0);
	});
});
