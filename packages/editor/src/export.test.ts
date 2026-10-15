import { describe, expect, it } from "vitest";
import { analyzeSnapshot } from "./document.js";
import { computeExportSources, exportFormats, runExports } from "./export.js";

describe("shared export contracts", () => {
	it("uses graph and effective metadata for whole DOT and TSV", () => {
		const model = analyzeSnapshot(
			'---\nartifact: {a: {label: 日本語, description: "one\\ttwo"}}\n---\na >> p -> b\n',
		);
		const sources = computeExportSources(model.graph, model.frontmatter);
		expect(sources.dot).toContain("日本語");
		expect(sources.tsv).toContain("日本語\tone two");
		expect(sources.dot).toContain('"b"');
	});
	it("retains each success path and distinguishes conversion from write failure", async () => {
		const writes: string[] = [];
		const result = await runExports(
			exportFormats,
			async (format) => {
				if (format === "pdf") throw new Error("PDF unavailable");
				return new TextEncoder().encode(format);
			},
			async (format, bytes) => {
				expect(new TextDecoder().decode(bytes)).toBe(format);
				if (format === "png") throw new Error("disk full");
				writes.push(format);
				return `/selected/日本語.${format}`;
			},
			["Preset warning"],
		);
		expect(result.map((r) => [r.format, r.status])).toEqual([
			["dot", "saved"],
			["svg", "saved"],
			["pdf", "conversion-failed"],
			["png", "write-failed"],
			["tsv", "saved"],
		]);
		expect(writes).toEqual(["dot", "svg", "tsv"]);
		expect(result[0]!.savedPath).toBe("/selected/日本語.dot");
		expect(result[0]!.warnings).toEqual(["Preset warning"]);
		expect(result[2]!.savedPath).toBeUndefined();
		expect(result[3]!.error).toContain("disk full");
		expect(
			(
				await runExports(
					["dot"],
					async () => new Uint8Array(),
					async () => "/saved.dot",
				)
			)[0]!.warnings,
		).toEqual([]);
	});
});
