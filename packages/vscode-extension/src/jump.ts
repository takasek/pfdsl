import { ID_PATTERN, loadFrontmatter } from "@pfdsl/core";
import * as vscode from "vscode";

export function findFrontmatterDefinition(
	doc: vscode.TextDocument,
	nodeId: string,
): vscode.Position | undefined {
	const text = doc.getText();
	const { bodyStartLine } = loadFrontmatter(text);
	const lines = text.split("\n");
	const fmEnd = bodyStartLine - 1;
	const pattern = new RegExp(`^(\\s+)(${escapeRegex(nodeId)})\\s*:`);
	for (let i = 0; i < fmEnd && i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const m = pattern.exec(line);
		if (m) {
			const indent = m[1] ?? "";
			return new vscode.Position(i, indent.length);
		}
	}
	return undefined;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function registerDefinitionJump(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.jumpToDefinition", () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "pfdsl") return;
			const { document: doc, selection } = editor;
			const range = doc.getWordRangeAtPosition(selection.active, ID_PATTERN);
			if (!range) return;
			const nodeId = doc.getText(range);
			const pos = findFrontmatterDefinition(doc, nodeId);
			if (!pos) {
				vscode.window.showInformationMessage(
					`No frontmatter definition found for "${nodeId}"`,
				);
				return;
			}
			const defRange = new vscode.Range(pos, pos.translate(0, nodeId.length));
			editor.selection = new vscode.Selection(
				pos,
				pos.translate(0, nodeId.length),
			);
			editor.revealRange(defRange);
		}),
	);
}
