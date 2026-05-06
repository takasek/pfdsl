import { ID_PATTERN } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";

export function registerHover(context: vscode.ExtensionContext): void {
	const provider: vscode.HoverProvider = {
		provideHover(doc, pos) {
			const range = doc.getWordRangeAtPosition(pos, ID_PATTERN);
			if (!range) return null;
			const id = doc.getText(range);

			const { frontmatter, nodeKinds } = analyzeDocument(doc);
			const kind = nodeKinds.get(id);
			if (!kind) return null;

			const lines: string[] = [`**${id}** _(${kind})_`];
			if (kind === "artifact") {
				const meta = frontmatter?.artifact?.[id];
				if (meta) {
					if (meta.title) lines.push(`title: ${meta.title}`);
					if (meta.owner) lines.push(`owner: ${meta.owner}`);
					if (meta.status) lines.push(`status: ${meta.status}`);
					if (meta.tags?.length) lines.push(`tags: ${meta.tags.join(", ")}`);
					if (meta.parts?.length) lines.push(`parts: ${meta.parts.join(", ")}`);
				}
			} else {
				const meta = frontmatter?.process?.[id];
				if (meta) {
					if (meta.title) lines.push(`title: ${meta.title}`);
					if (meta.owner) lines.push(`owner: ${meta.owner}`);
				}
			}

			const md = new vscode.MarkdownString(lines.join("  \n"));
			md.isTrusted = false;
			return new vscode.Hover(md, range);
		},
	};

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(LANGUAGE_ID, provider),
	);
}
