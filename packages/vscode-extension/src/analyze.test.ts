import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter";
import { describe, expect, it } from "vitest";
import { resolveEffectiveFrontmatterForUri } from "./analyze.js";

describe("resolveEffectiveFrontmatterForUri", () => {
	it("uses edited locals and extends before and after saving, including a new file", () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-1346-"));
		try {
			const path = join(d, "main.pfdsl");
			writeFileSync(
				join(d, "old.yaml"),
				"statusStyles: {done: {fillcolor: blue}}\n",
			);
			writeFileSync(
				join(d, "new.yaml"),
				"statusStyles: {done: {color: green}}\ntag: {t: {label: new}}\ngroup: {g: {label: new}}\n",
			);
			const saved =
				"---\nextends: old.yaml\nstatusStyles: {done: {fillcolor: blue}}\n---\n";
			const fm = {
				artifact: { a: { status: "done" as const, group: "g", tags: ["t"] } },
				extends: "new.yaml",
				statusStyles: { done: { fillcolor: "red" } },
				tag: { t: { label: "local" } },
				group: { g: { label: "local" } },
			};
			const uri = { scheme: "file", fsPath: path };
			for (const phase of ["new", "edited", "saved"]) {
				if (phase === "edited") writeFileSync(path, saved);
				if (phase === "saved")
					writeFileSync(path, "---\nextends: new.yaml\n---\n");
				const effective = resolveEffectiveFrontmatterForUri(uri, fm);
				expect(effective?.statusStyles?.done).toEqual({
					color: "green",
					fillcolor: "red",
				});
				expect(effective?.tag?.t?.label).toBe("local");
				expect(effective?.group?.g?.label).toBe("local");
				const graph = analyze("a >> p -> b").graph;
				const dot = exportDot(graph, effective);
				expect(dot).toContain('fillcolor="red"');
				expect(dot).toContain('color="green"');
				expect(dot).toContain('label="local"');
			}
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});
	it("merges extends-inherited statusStyles for a file:// document (#427)", () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-ext-extends-"));
		try {
			writeFileSync(
				join(d, "preset.yaml"),
				["statusStyles:", "  done:", '    fillcolor: "#4CAF50"'].join("\n"),
			);
			const fm = { extends: "./preset.yaml" };
			writeFileSync(
				join(d, "main.pfdsl"),
				["---", "extends: ./preset.yaml", "---", "a >> P -> b"].join("\n"),
			);
			const eff = resolveEffectiveFrontmatterForUri(
				{ scheme: "file", fsPath: join(d, "main.pfdsl") },
				fm,
			);
			expect(eff?.statusStyles?.done?.fillcolor).toBe("#4CAF50");
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("returns the frontmatter unchanged for a non-file scheme (e.g. untitled)", () => {
		const fm = { extends: "./preset.yaml" };
		const eff = resolveEffectiveFrontmatterForUri(
			{ scheme: "untitled", fsPath: "Untitled-1" },
			fm,
		);
		expect(eff).toBe(fm);
	});

	it("returns the frontmatter unchanged when it has no extends", () => {
		const d = mkdtempSync(join(tmpdir(), "pfdsl-ext-extends-"));
		try {
			const fm = { title: "t" };
			const eff = resolveEffectiveFrontmatterForUri(
				{ scheme: "file", fsPath: join(d, "main.pfdsl") },
				fm,
			);
			expect(eff).toBe(fm);
		} finally {
			rmSync(d, { recursive: true, force: true });
		}
	});
});
