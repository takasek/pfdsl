import { pathToFileURL } from "node:url";
import { analyzeSource, isUrlLike, resolveLocationFsPath } from "@pfdsl/core";
import { documentReferences } from "@pfdsl/editor";

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
	for (const { field: key, value, range } of documentReferences(model)) {
		const target = isUrlLike(value)
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
	return links;
}
