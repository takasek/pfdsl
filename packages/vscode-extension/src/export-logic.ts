/**
 * The decisions the export command makes, apart from talking to vscode.
 *
 * export.ts picks a path through a save dialog and writes files; what it
 * names them and what it reports when only part of the set could be produced
 * were inline in that flow, behind the coverage exclusions (#634).
 */

/**
 * The path without its extension, which the "export all" flow appends to.
 * A leading dot is part of the name, not an extension — `.pfdslrc` keeps its
 * dot rather than collapsing to the directory.
 */
export function exportStem(fsPath: string): string {
	return fsPath.replace(/(?<=[^./\\])\.[^./\\]+$/, "");
}

export interface ExportAllOutcome {
	kind: "info" | "warning";
	message: string;
}

/**
 * What to tell the user after an "export all". PDF and PNG need puppeteer,
 * which may be absent, so the set is reported as produced-minus-skipped
 * rather than as a failure: the dot/svg/tsv files were still written.
 */
export function exportAllOutcome(
	stem: string,
	skipped: readonly string[],
): ExportAllOutcome {
	if (skipped.length === 0) {
		return {
			kind: "info",
			message: `Exported: ${stem}.dot / .svg / .pdf / .png / .tsv`,
		};
	}
	return {
		kind: "warning",
		message: `Exported: ${stem}.* (${skipped.join(", ")} skipped — puppeteer required)`,
	};
}

/** The formats a settled pair of binary renders could not produce. */
export function skippedBinaryFormats(
	pdf: PromiseSettledResult<unknown>,
	png: PromiseSettledResult<unknown>,
): string[] {
	const skipped: string[] = [];
	if (pdf.status !== "fulfilled") skipped.push("PDF");
	if (png.status !== "fulfilled") skipped.push("PNG");
	return skipped;
}
