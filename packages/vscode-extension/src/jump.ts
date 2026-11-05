import type { Range } from "@pfdsl/core";
import {
	findFrontmatterDefinitionRange,
	nextNodeOccurrenceRange,
	nodeIdAtSourcePosition,
} from "@pfdsl/editor";
import * as vscode from "vscode";
import { analyzeDocument } from "./analyze.js";

export type { FrontmatterPosition } from "@pfdsl/editor";
export { findFrontmatterDefinitionInText } from "@pfdsl/editor";

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
			const model = analyzeDocument(doc);
			const nodeId = nodeIdAtSourcePosition(
				model,
				doc.getText(),
				selection.active,
			);
			if (nodeId === undefined) return;
			const range = findFrontmatterDefinitionRange(model, nodeId);
			if (!range) {
				vscode.window.showInformationMessage(
					`No frontmatter definition found for "${nodeId}"`,
				);
				return;
			}
			selectSourceRange(editor, range);
		}),
		vscode.commands.registerCommand("pfdsl.cycleNodeOccurrence", () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "pfdsl") return;
			const range = nextNodeOccurrenceRange(
				analyzeDocument(editor.document),
				editor.document.getText(),
				editor.selection.active,
			);
			if (range) selectSourceRange(editor, range);
		}),
	);
}

function selectSourceRange(editor: vscode.TextEditor, range: Range): void {
	const start = new vscode.Position(
		range.start.line - 1,
		range.start.column - 1,
	);
	const end = new vscode.Position(range.end.line - 1, range.end.column - 1);
	editor.selection = new vscode.Selection(start, end);
	editor.revealRange(new vscode.Range(start, end));
}
