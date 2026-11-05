import { type Document, isAlias, isMap, isNode, isScalar, isSeq } from "yaml";
import type { Range } from "./types/index.js";

export interface SourceValue {
	value: string;
	/** Authored token range, with surrounding scalar quotes excluded. */
	range: Range;
}

export interface SourceField {
	keyRange: Range;
	values: SourceValue[];
}

export interface SourceDeclaration {
	section: "artifact" | "process" | "group" | "tag";
	id: string;
	range: Range;
	fields: ReadonlyMap<string, SourceField>;
}

/** Read-only source index of the same YAML document used for semantic loading. */
export interface FrontmatterSource {
	declarations: readonly SourceDeclaration[];
}

export function buildFrontmatterSource(
	source: string,
	doc: Document,
	yamlOffset: number,
): FrontmatterSource {
	const declarations: SourceDeclaration[] = [];
	const starts = [0];
	for (let i = 0; i < source.length; i++)
		if (source[i] === "\n") starts.push(i + 1);
	function position(offset: number) {
		let lo = 0;
		let hi = starts.length;
		while (lo + 1 < hi) {
			const mid = (lo + hi) >>> 1;
			if (starts[mid]! <= offset) lo = mid;
			else hi = mid;
		}
		return { offset, line: lo + 1, column: offset - starts[lo]! + 1 };
	}
	function range(node: unknown, content = false): Range | undefined {
		if (!isNode(node) || !node.range) return undefined;
		let start = yamlOffset + node.range[0];
		let end = yamlOffset + node.range[1];
		if (
			content &&
			isScalar(node) &&
			(node.type === "QUOTE_DOUBLE" || node.type === "QUOTE_SINGLE")
		) {
			start++;
			end--;
		}
		return { start: position(start), end: position(end) };
	}
	function resolved(node: unknown): unknown {
		return isAlias(node) ? node.resolve(doc) : node;
	}
	function values(
		node: unknown,
		useSite?: Range,
		stack = new Set<unknown>(),
	): SourceValue[] {
		const target = resolved(node);
		if (stack.has(target)) return [];
		const authored = useSite ?? (isAlias(node) ? range(node) : undefined);
		if (isSeq(target)) {
			stack.add(target);
			const result = target.items.flatMap((item) =>
				values(item, authored, stack),
			);
			stack.delete(target);
			return result;
		}
		if (!isScalar(target) || typeof target.value !== "string") return [];
		const span = authored ?? range(target, true);
		return span ? [{ value: target.value, range: span }] : [];
	}
	if (doc.errors.length) return { declarations };
	if (!isMap(doc.contents)) return { declarations };
	for (const sectionPair of doc.contents.items) {
		const sectionKey = resolved(sectionPair.key);
		if (!isScalar(sectionKey)) continue;
		const section = sectionKey.value;
		if (
			section !== "artifact" &&
			section !== "process" &&
			section !== "group" &&
			section !== "tag"
		)
			continue;
		const sectionNode = sectionPair.value;
		const sectionUse = isAlias(sectionNode) ? range(sectionNode) : undefined;
		const sectionMap = resolved(sectionNode);
		if (!isMap(sectionMap)) continue;
		for (const pair of sectionMap.items) {
			const key = resolved(pair.key);
			const declarationRange = sectionUse ?? range(pair.key);
			if (!isScalar(key) || typeof key.value !== "string" || !declarationRange)
				continue;
			const fields = new Map<string, SourceField>();
			const map = resolved(pair.value);
			const useSite =
				sectionUse ?? (isAlias(pair.value) ? range(pair.value) : undefined);
			if (isMap(map))
				for (const field of map.items) {
					const fieldKey = resolved(field.key);
					const keyRange = useSite ?? range(field.key);
					if (
						!isScalar(fieldKey) ||
						typeof fieldKey.value !== "string" ||
						!keyRange
					)
						continue;
					fields.set(fieldKey.value, {
						keyRange,
						values: values(field.value, useSite),
					});
				}
			declarations.push({
				section,
				id: key.value,
				range: declarationRange,
				fields,
			});
		}
	}
	return { declarations };
}
