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

			const { frontmatter, nodeKinds, bodyStartLine } =
				analyzeDocument(document);
			const kind = findUndefinedNodeKind(nodeKinds, frontmatter, id);
			if (!kind) return;

			const source = document.getText();
			const { inserted, output } = insertDefinition(source, kind, id);
			if (!inserted) return;

			const action = new vscode.CodeAction(
				`Insert ${kind} definition for "${id}"`,
				vscode.CodeActionKind.QuickFix,
			);
			// insertDefinition (ADR-0034) rewrites frontmatter through the yaml
			// CST, which can reformat any part of the block — so the edit
			// replaces the whole frontmatter range (or inserts one fresh at the
			// top when there was none) rather than the single-line minimal
			// insert this used before (#494's concurrency guard no longer
			// applies: there is no smaller edit that's still guaranteed
			// consistent with a CST-driven rewrite).
			action.edit = new vscode.WorkspaceEdit();
			action.edit.replace(
				document.uri,
				new vscode.Range(
					new vscode.Position(0, 0),
					new vscode.Position(bodyStartLine - 1, 0),
				),
				output,
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
