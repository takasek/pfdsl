import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	DIAGNOSTIC_REGISTRY,
	extractDiagnosticCodesFromSource,
} from "./diagnostics-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("extractDiagnosticCodesFromSource", () => {
	it("extracts a code paired with a preceding plain-literal severity", () => {
		const src = `
			diagnostics.push({
				severity: "error",
				code: "X001",
				message: "boom",
			});
		`;
		expect(extractDiagnosticCodesFromSource(src)).toEqual({
			X001: ["error"],
		});
	});

	it("extracts a code paired with a following plain-literal severity", () => {
		const src = `
			diagnostics.push({
				code: "X002",
				severity: "warning",
				message: "boom",
			});
		`;
		expect(extractDiagnosticCodesFromSource(src)).toEqual({
			X002: ["warning"],
		});
	});

	it("normalizes the options?.strict ternary to [warning, error]", () => {
		const src = `
			diagnostics.push({
				severity: options?.strict ? "error" : "warning",
				code: "X003",
				message: "boom",
			});
		`;
		expect(extractDiagnosticCodesFromSource(src)).toEqual({
			X003: ["warning", "error"],
		});
	});

	it("collects multiple distinct codes from one source string", () => {
		const src = `
			diagnostics.push({ severity: "error", code: "X004", message: "a" });
			diagnostics.push({ severity: "warning", code: "X005", message: "b" });
		`;
		expect(extractDiagnosticCodesFromSource(src)).toEqual({
			X004: ["error"],
			X005: ["warning"],
		});
	});
});

describe("DIAGNOSTIC_REGISTRY section/summary metadata", () => {
	it("every entry has a section number and a non-empty one-line summary", () => {
		for (const [code, entry] of Object.entries(DIAGNOSTIC_REGISTRY)) {
			expect(entry.section, `${code} section`).toMatch(/^\d+(\.\d+){0,2}$/);
			expect(entry.summary, `${code} summary`).not.toBe("");
			expect(entry.summary, `${code} summary must be one line`).not.toMatch(
				/\n/,
			);
		}
	});
});

describe("DIAGNOSTIC_REGISTRY vs. real source", () => {
	// Walking the tree beats naming the files: a hard-coded list silently stops
	// covering a code when the emitting rule moves to a new module, which is
	// exactly what happened when the validator was split into rules/.
	function sourceFilesUnder(dir: string): string[] {
		const files: string[] = [];
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...sourceFilesUnder(full));
			} else if (
				entry.name.endsWith(".ts") &&
				!entry.name.endsWith(".test.ts") &&
				entry.name !== "diagnostics-registry.ts"
			) {
				files.push(full);
			}
		}
		return files;
	}

	const foundByFile = sourceFilesUnder(__dirname).map((f) =>
		extractDiagnosticCodesFromSource(readFileSync(f, "utf8")),
	);
	const found: Record<string, string[]> = Object.assign({}, ...foundByFile);

	it("every code found in source exists in DIAGNOSTIC_REGISTRY", () => {
		const missing = Object.keys(found).filter(
			(code) => !(code in DIAGNOSTIC_REGISTRY),
		);
		expect(missing).toEqual([]);
	});

	it("every code in DIAGNOSTIC_REGISTRY was actually found in source", () => {
		const stale = Object.keys(DIAGNOSTIC_REGISTRY).filter(
			(code) => !(code in found),
		);
		expect(stale).toEqual([]);
	});

	it("severities match between source and registry", () => {
		const mismatches = Object.keys(found)
			.filter((code) => code in DIAGNOSTIC_REGISTRY)
			.filter((code) => {
				const a = [...(found[code] ?? [])].sort();
				const b = [...(DIAGNOSTIC_REGISTRY[code]?.severities ?? [])].sort();
				return JSON.stringify(a) !== JSON.stringify(b);
			});
		expect(mismatches).toEqual([]);
	});
});
