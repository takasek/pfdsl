import { pathToFileURL } from "node:url";
import { analyzeSource } from "@pfdsl/core";
import { documentReferences, resolveDocumentReference } from "@pfdsl/editor";

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
	for (const reference of documentReferences(model)) {
		let target: string;
		try {
			const resolved = resolveDocumentReference(
				docFsPath,
				reference,
				model.frontmatter.basePath,
				model.frontmatter,
			);
			target =
				resolved.kind === "url"
					? resolved.value
					: pathToFileURL(resolved.value).href;
		} catch {
			// Static editor links cannot acquire or select an external resource version.
			continue;
		}
		const { range } = reference;
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
