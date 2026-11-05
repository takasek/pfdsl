import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The exclusion list is the one place a file can leave the coverage floor's
 * reach, and nothing used to look at it: an entry could be added in the same
 * commit that raised the floor, and the numbers would agree (#634). Pinning
 * the list does not judge whether an entry is justified — it makes every
 * change to it show up as a diff a reviewer has to accept.
 *
 * Read as text rather than imported: the config lives outside this package's
 * tsconfig rootDir, so importing it fails typecheck (TS6059).
 */
const configText = readFileSync(
	resolve(dirname(fileURLToPath(import.meta.url)), "../vitest.config.ts"),
	"utf-8",
);

/** The `"**\/name.ts"` entries listed literally in the exclude array. */
function excludedPaths(source: string): string[] {
	const block = /exclude:\s*\[([\s\S]*?)\]/.exec(source)?.[1];
	if (block === undefined) {
		throw new Error("vitest.config.ts no longer has an exclude array");
	}
	return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("coverage exclusions", () => {
	const excluded = excludedPaths(configText);

	it("keeps exactly these vscode-host files out of the floor", () => {
		expect(excluded).toMatchInlineSnapshot(`
			[
			  "**/codelens.ts",
			  "**/connector.ts",
			  "**/def-insertion.ts",
			  "**/diagnostics.ts",
			  "**/diff.ts",
			  "**/document-link.ts",
			  "**/export.ts",
			  "**/extension.ts",
			  "**/format.ts",
			  "**/hover.ts",
			  "**/jump.ts",
			  "**/preview.ts",
			  "**/sort-meta.ts",
			  "**/utils.ts",
			  "**/webview.ts",
			]
		`);
	});

	it("never excludes a *-logic.ts, which is where the testable half lives", () => {
		expect(excluded.filter((p) => p.includes("-logic"))).toEqual([]);
	});

	it("finds the entries at all, so a rename of the array cannot pass silently", () => {
		expect(excluded.length).toBeGreaterThan(0);
	});

	it("limits the coverage floor to TypeScript production sources", () => {
		expect(configText).toMatch(/include:\s*\["src\/\*\*\/\*\.ts"\]/);
	});
});
