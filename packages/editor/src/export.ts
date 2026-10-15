import type { Frontmatter, Graph } from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter/dot";
import { extractMetadata, toTsv } from "@pfdsl/metadata-exporter";

export const exportFormats = ["dot", "svg", "pdf", "png", "tsv"] as const;
export type ExportFormat = (typeof exportFormats)[number];
export interface ExportResult {
	format: ExportFormat;
	status: "saved" | "conversion-failed" | "write-failed";
	savedPath?: string;
	error?: string;
	warnings: string[];
}

/** Whole-graph sources; no preview viewport, focus or comparison decorations. */
export function computeExportSources(
	graph: Graph,
	effective: Frontmatter | null,
) {
	return {
		dot: exportDot(graph, effective),
		tsv: toTsv(extractMetadata(graph, effective)),
	};
}

/** Each format owns its outcome; a later failure never rewrites a successful result. */
export async function runExports(
	formats: readonly ExportFormat[],
	convert: (format: ExportFormat) => Promise<Uint8Array>,
	write: (format: ExportFormat, bytes: Uint8Array) => Promise<string>,
	warnings: readonly string[] = [],
): Promise<ExportResult[]> {
	const results: ExportResult[] = [];
	for (const format of formats) {
		let bytes: Uint8Array;
		try {
			bytes = await convert(format);
		} catch (error) {
			results.push({
				format,
				status: "conversion-failed",
				error: String(error),
				warnings: [...warnings],
			});
			continue;
		}
		try {
			results.push({
				format,
				status: "saved",
				savedPath: await write(format, bytes),
				warnings: [...warnings],
			});
		} catch (error) {
			results.push({
				format,
				status: "write-failed",
				error: String(error),
				warnings: [...warnings],
			});
		}
	}
	return results;
}
