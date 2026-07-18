import { ID_PATTERN, insertDefinition } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";
import { findUndefinedNodeKind } from "./def-insertion-logic.js";

export function registerDefInsertion(context: vscode.ExtensionContext): void {
	const provider: vscode.CodeActionProvider = {
		provideCodeActions(document, range) {
			if (document.languageId !== LANGUAGE_ID) return;
			const wordRange = document.getWordRangeAtPosition(
				range.start,
				ID_PATTERN,
			);
			if (!wordRange) return;
			const id = document.getText(wordRange);

			const { frontmatter, nodeKinds } = analyzeDocument(document);
			const kind = findUndefinedNodeKind(nodeKinds, frontmatter, id);
			if (!kind) return;

			const source = document.getText();
			const { output, inserted } = insertDefinition(source, kind, id);
			if (!inserted) return;

			const action = new vscode.CodeAction(
				`Insert ${kind} definition for "${id}"`,
				vscode.CodeActionKind.QuickFix,
			);
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(source.length),
			);
			action.edit = new vscode.WorkspaceEdit();
			action.edit.replace(document.uri, fullRange, output);
			return [action];
		},
	};

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(LANGUAGE_ID, provider, {
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
		}),
	);
}
