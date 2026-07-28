import { escapeRe, loadFrontmatter } from "@pfdsl/core";

export interface FrontmatterPosition {
	line: number;
	column: number;
}

export function findFrontmatterDefinitionInText(
	text: string,
	nodeId: string,
): FrontmatterPosition | undefined {
	const { bodyStartLine } = loadFrontmatter(text);
	const lines = text.split("\n");
	const fmEnd = bodyStartLine - 1;
	const pattern = new RegExp(`^(\\s+)(${escapeRe(nodeId)})\\s*:`);
	for (let i = 0; i < fmEnd && i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const m = pattern.exec(line);
		if (m) {
			const indent = m[1] ?? "";
			return { line: i, column: indent.length };
		}
	}
	return undefined;
}
