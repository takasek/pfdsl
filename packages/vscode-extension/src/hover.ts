import { ID_PATTERN } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";
import { buildHoverLines } from "./hover-logic.js";

export { buildHoverLines } from "./hover-logic.js";

export function registerHover(context: vscode.ExtensionContext): void {
	const provider: vscode.HoverProvider = {
		provideHover(doc, pos) {
			const range = doc.getWordRangeAtPosition(pos, ID_PATTERN);
			if (!range) return null;
			const id = doc.getText(range);

			const { frontmatter, nodeKinds } = analyzeDocument(doc);
			const kind = nodeKinds.get(id);
			if (!kind) return null;

			const lines = buildHoverLines(id, kind, frontmatter);
			const md = new vscode.MarkdownString(lines.join("  \n"));
			md.isTrusted = false;
			return new vscode.Hover(md, range);
		},
	};

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(LANGUAGE_ID, provider),
	);
}
