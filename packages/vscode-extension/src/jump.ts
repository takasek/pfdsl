import { ID_PATTERN } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument } from "./analyze.js";
import { findFrontmatterDefinitionRange } from "./jump-logic.js";

export type { FrontmatterPosition } from "./jump-logic.js";
export { findFrontmatterDefinitionInText } from "./jump-logic.js";

export function findFrontmatterDefinition(
	doc: vscode.TextDocument,
	nodeId: string,
): vscode.Position | undefined {
	const range = findFrontmatterDefinitionRange(analyzeDocument(doc), nodeId);
	if (!range) return undefined;
	return new vscode.Position(range.start.line - 1, range.start.column - 1);
}

export function registerDefinitionJump(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.jumpToDefinition", () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "pfdsl") return;
			const { document: doc, selection } = editor;
			const wordRange = doc.getWordRangeAtPosition(
				selection.active,
				ID_PATTERN,
			);
			if (!wordRange) return;
			const nodeId = doc.getText(wordRange);
			const range = findFrontmatterDefinitionRange(
				analyzeDocument(doc),
				nodeId,
			);
			if (!range) {
				vscode.window.showInformationMessage(
					`No frontmatter definition found for "${nodeId}"`,
				);
				return;
			}
			const pos = new vscode.Position(
				range.start.line - 1,
				range.start.column - 1,
			);
			const end = new vscode.Position(range.end.line - 1, range.end.column - 1);
			const defRange = new vscode.Range(pos, end);
			editor.selection = new vscode.Selection(pos, end);
			editor.revealRange(defRange);
		}),
	);
}
