import { describe, expect, it } from "vitest";
import { sharedCoverageExclude } from "../../../vitest.shared.js";
import config from "../vitest.config.js";

/**
 * The exclusion list is the one place a file can leave the coverage floor's
 * reach, and nothing used to look at it: an entry could be added in the same
 * commit that raised the floor, and the numbers would agree (#634). Pinning
 * the list does not judge whether an entry is justified — it makes every
 * change to it show up as a diff a reviewer has to accept.
 */
describe("coverage exclusions", () => {
	const all =
		(config as { test?: { coverage?: { exclude?: string[] } } }).test?.coverage
			?.exclude ?? [];
	/** What this package excludes beyond the repo-wide defaults. */
	const packageSpecific = [
		...new Set(all.filter((p) => !sharedCoverageExclude.includes(p))),
	];

	it("keeps exactly these vscode-host files out of the floor", () => {
		expect(packageSpecific).toMatchInlineSnapshot(`
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
		expect(packageSpecific.filter((p) => p.includes("-logic"))).toEqual([]);
	});
});
