import { isAbsolute, join } from "node:path";
import {
	diffGraphs,
	type Frontmatter,
	hasErrors,
	isUrlLike,
	type Range,
	resolveReference,
	resolveRefPath,
} from "@pfdsl/core";
import { analyzeSnapshot, type DocumentModel } from "./document.js";

export interface DocumentReference {
	kind: "artifact" | "process";
	id: string;
	field: "location" | "subflow";
	value: string;
	range: Range;
}
export type ReferenceTarget = { kind: "path" | "url"; value: string };
export const joinReferencePath = (directory: string, name: string) =>
	join(directory, name);

/** Decoded references retain their full authored YAML value spans. */
export function documentReferences(
	model: Pick<DocumentModel, "sourceMap">,
): DocumentReference[] {
	return model.sourceMap.declarations.flatMap((declaration) => {
		if (declaration.section !== "artifact" && declaration.section !== "process")
			return [];
		const kind = declaration.section;
		return (["location", "subflow"] as const).flatMap((field) => {
			if (field === "subflow" && declaration.section !== "process") return [];
			return (declaration.fields.get(field)?.values ?? [])
				.filter(({ value }) => value.length > 0)
				.map(({ value, range }) => ({
					kind,
					id: declaration.id,
					field,
					value,
					range,
				}));
		});
	});
}

export function resolveDocumentReference(
	path: string | null,
	reference: Pick<DocumentReference, "kind" | "id" | "field" | "value">,
	basePath?: string,
	frontmatter?: Frontmatter | null,
): ReferenceTarget {
	if (reference.field === "subflow") {
		if (!path)
			throw new Error(
				"Save this document before opening a relative reference.",
			);
		const result = resolveRefPath(path, reference.value);
		if (!result.ok) throw new Error("A subflow must be a relative file path.");
		return { kind: "path", value: result.path };
	}
	if (isUrlLike(reference.value))
		return { kind: "url", value: reference.value };
	const resolved = resolveReference({
		docPath: path ?? "/untitled.pfdsl",
		frontmatter: {
			...frontmatter,
			...(basePath === undefined ? {} : { basePath }),
		},
		nodeKind: reference.kind,
		nodeId: reference.id,
		field: reference.field,
		value: reference.value,
	});
	if (!resolved.ok) throw new Error(resolved.message);
	if (!path && !isAbsolute(reference.value))
		throw new Error("Save this document before opening a relative reference.");
	return {
		kind: "path",
		value: resolved.value,
	};
}

/** Baseline is a; the current unsaved authored source is b, including metadata. */
export function compareDocumentSources(baseline: string, current: string) {
	const a = analyzeSnapshot(baseline);
	const b = analyzeSnapshot(current);
	if (hasErrors(a.diagnostics) || hasErrors(b.diagnostics))
		throw new Error(
			"Fix document diagnostics before comparing. The comparison source must also have no errors.",
		);
	return diffGraphs(a.graph, b.graph, a.frontmatter, b.frontmatter);
}
