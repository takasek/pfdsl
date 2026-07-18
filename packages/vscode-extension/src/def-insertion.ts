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
			const { inserted, insertion } = insertDefinition(source, kind, id);
			if (!inserted || !insertion) return;

			const action = new vscode.CodeAction(
				`Insert ${kind} definition for "${id}"`,
				vscode.CodeActionKind.QuickFix,
			);
			// Minimal edit (insert only) instead of a full-document replace, so a
			// concurrent edit elsewhere in the document between code-action
			// computation and application isn't silently discarded (#494).
			action.edit = new vscode.WorkspaceEdit();
			action.edit.insert(
				document.uri,
				new vscode.Position(insertion.line, 0),
				insertion.text,
			);
			return [action];
		},
	};

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(LANGUAGE_ID, provider, {
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
		}),
	);
}
