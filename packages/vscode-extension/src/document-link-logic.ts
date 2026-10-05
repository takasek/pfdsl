import { pathToFileURL } from "node:url";
import { analyzeSource, resolveLocationFsPath } from "@pfdsl/core";

export interface LinkRange {
	line: number;
	startChar: number;
	endLine?: number;
	endChar: number;
	target: string;
}

/** Links use decoded YAML values and authored token spans from one snapshot. */
export function extractDocumentLinks(
	source: string | ReturnType<typeof analyzeSource>,
	docFsPath: string,
): LinkRange[] {
	const model = typeof source === "string" ? analyzeSource(source) : source;
	const links: LinkRange[] = [];
	if (!model.frontmatter) return links;
	for (const declaration of model.sourceMap.declarations) {
		if (declaration.section !== "artifact" && declaration.section !== "process")
			continue;
		for (const key of ["location", "subflow"]) {
			if (key === "subflow" && declaration.section !== "process") continue;
			for (const { value, range } of declaration.fields.get(key)?.values ??
				[]) {
				if (!value) continue;
				const target = value.includes("://")
					? value
					: pathToFileURL(
							resolveLocationFsPath(
								docFsPath,
								value,
								key === "location" ? model.frontmatter.basePath : undefined,
							),
						).href;
				links.push({
					line: range.start.line - 1,
					startChar: range.start.column - 1,
					endChar: range.end.column - 1,
					...(range.end.line !== range.start.line
						? { endLine: range.end.line - 1 }
						: {}),
					target,
				});
			}
		}
	}
	return links;
}
