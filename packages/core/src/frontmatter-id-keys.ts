import {
	type Document,
	isAlias,
	isMap,
	isNode,
	isScalar,
	type Node,
} from "yaml";

/** Inspect authored keys before YAML converts them to JavaScript property names. */
export function invalidIdKeys(
	document: Document,
): { section: string; node: Node | undefined }[] {
	const invalid: { section: string; node: Node | undefined }[] = [];
	if (!isMap(document.contents)) return invalid;
	for (const declaration of document.contents.items) {
		const sectionKey = isAlias(declaration.key)
			? declaration.key.resolve(document)
			: declaration.key;
		if (
			!isScalar(sectionKey) ||
			typeof sectionKey.value !== "string" ||
			!["artifact", "process", "group", "tag"].includes(sectionKey.value)
		)
			continue;
		const section = sectionKey.value;
		const original = declaration.value;
		const entries = isAlias(original) ? original.resolve(document) : original;
		if (!isMap(entries)) continue;
		for (const pair of entries.items) {
			const key = isAlias(pair.key) ? pair.key.resolve(document) : pair.key;
			if (!isScalar(key) || typeof key.value !== "string") {
				const location = isAlias(original) ? original : pair.key;
				invalid.push({
					section,
					node: isNode(location) ? location : undefined,
				});
			}
		}
	}
	return invalid;
}
