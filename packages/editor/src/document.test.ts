import { describe, expect, it } from "vitest";
import { analyzeSnapshot, preloadPresets, prepareDocument } from "./index.js";

describe("shared document pipeline", () => {
	it("reports raw YAML dependency positions in the original file", async () => {
		const source = "group:\n  g: {parent: 2}\n";
		const model = analyzeSnapshot("---\nextends: preset.yaml\n---\na\n");
		const load = await preloadPresets(
			"/project/main.pfdsl",
			model,
			async () => source,
		);
		const result = prepareDocument(model, "/project/main.pfdsl", load);
		const diagnostic = result.presetDiagnostics.find(
			(d) => d.code === "FM004",
		)!;
		expect(diagnostic.range.start.line).toBe(2);
		expect(
			source.slice(diagnostic.range.start.offset, diagnostic.range.end.offset),
		).toBe("2");
	});
	it("loads child presets once and keeps dependency errors lenient in the preview", async () => {
		const model = analyzeSnapshot(
			"---\nprocess:\n  p: {subflow: child.pfdsl}\n  q: {subflow: other.pfdsl}\n---\na >> p -> b\na >> q -> d\n",
		);
		const reads: string[] = [];
		const load = await preloadPresets(
			"/project/main.pfdsl",
			model,
			async (path) => {
				reads.push(path);
				if (path.endsWith(".pfdsl"))
					return "---\nextends: preset.yaml\n---\na >> c -> b\n";
				return "statusStyles: {done: {fill: red}}\n";
			},
		);
		expect(
			reads.filter((path) => path === "/project/preset.yaml"),
		).toHaveLength(1);
		expect(reads).not.toContain("/project/main.pfdsl");
		const result = prepareDocument(model, "/project/main.pfdsl", load);
		expect(result.presetDiagnostics).toContainEqual(
			expect.objectContaining({ code: "V009", file: "/project/preset.yaml" }),
		);
		expect(result.message.type).toBe("render");
	});
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
