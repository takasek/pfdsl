import { ID_PATTERN } from "@pfdsl/core";
import * as vscode from "vscode";
import { findFrontmatterDefinitionInText } from "./jump-logic.js";

export type { FrontmatterPosition } from "./jump-logic.js";
export { findFrontmatterDefinitionInText } from "./jump-logic.js";

export function findFrontmatterDefinition(
	doc: vscode.TextDocument,
	nodeId: string,
): vscode.Position | undefined {
	const pos = findFrontmatterDefinitionInText(doc.getText(), nodeId);
	if (!pos) return undefined;
	return new vscode.Position(pos.line, pos.column);
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
