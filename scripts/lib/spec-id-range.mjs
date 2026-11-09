/**
 * Block ownership and ranges for ADR-0027 SPEC definitions. CommonMark/GFM
 * nodes determine ownership; heading ranges extend to the next heading of
 * equal or lesser depth in document order.
 * Marker detection stays in findSpecIdDefinitions (spec-id-check.mjs).
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmTableFromMarkdown } from "mdast-util-gfm-table";
import { gfmTable } from "micromark-extension-gfm-table";

/**
 * @typedef {{type: "heading"|"list-item"|"table-row"|"paragraph", startLine: number, endLine: number, startOffset: number}} Block
 */

/**
 * Parses once and returns a locator with stable block object identity.
 * The first paragraph of a list item belongs to that item; later paragraphs
 * own their definitions. Unsupported blocks and blank lines return null.
 * @param {string} text
 * @returns {(lineNumber: number) => Block | null}
 */
export function createBlockLocator(text) {
	const tree = fromMarkdown(text, {
		extensions: [gfmTable()],
		mdastExtensions: [gfmTableFromMarkdown()],
	});
	const candidates = [];
	const headings = [];
	function visit(node, parent, depth) {
		if (["heading", "paragraph", "tableRow"].includes(node.type)) {
			candidates.push({ node, parent, depth });
			if (node.type === "heading") headings.push(node);
		}
		for (const child of node.children ?? []) visit(child, node, depth + 1);
	}
	visit(tree, null, 0);
	const lines = text.split("\n");
	const lastLine = lines.length - (lines.at(-1) === "" ? 1 : 0);
	const blocks = new Map();
	for (const { node, parent } of candidates) {
		const owner =
			node.type === "paragraph" &&
			parent?.type === "listItem" &&
			parent.children[0] === node
				? parent
				: node;
		let endLine = owner.position.end.line;
		if (owner.type === "heading") {
			const next = headings
				.slice(headings.indexOf(owner) + 1)
				.find((heading) => heading.depth <= owner.depth);
			endLine = next ? next.position.start.line - 1 : lastLine;
		}
		blocks.set(node, {
			type:
				owner.type === "listItem"
					? "list-item"
					: owner.type === "tableRow"
						? "table-row"
						: owner.type,
			startLine: owner.position.start.line,
			endLine,
			startOffset: owner.position.start.offset,
		});
	}
	return (lineNumber) => {
		let deepest = null;
		for (const candidate of candidates) {
			if (
				candidate.node.position.start.line <= lineNumber &&
				lineNumber <= candidate.node.position.end.line &&
				(deepest === null || candidate.depth > deepest.depth)
			) {
				deepest = candidate;
			}
		}
		return deepest ? blocks.get(deepest.node) : null;
	};
}

/**
 * Classifies the deepest supported block containing the given source line.
 * @param {string[]} lines
 * @param {number} lineIndex 0-indexed
 * @returns {"heading"|"list-item"|"table-row"|"paragraph"|null}
 */
export function classifyBlock(lines, lineIndex) {
	return createBlockLocator(lines.join("\n"))(lineIndex + 1)?.type ?? null;
}

/**
 * @param {string} text
 * @param {number} lineNumber 1-indexed line where a definition marker sits
 * @returns {{startLine: number, endLine: number}} 1-indexed closed range
 */
export function computeRange(text, lineNumber) {
	const block = createBlockLocator(text)(lineNumber);
	return block
		? { startLine: block.startLine, endLine: block.endLine }
		: { startLine: lineNumber, endLine: lineNumber };
}
