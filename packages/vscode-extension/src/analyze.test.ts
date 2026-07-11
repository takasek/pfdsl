import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEffectiveFrontmatterForUri } from "./analyze.js";

describe("resolveEffectiveFrontmatterForUri", () => {
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
