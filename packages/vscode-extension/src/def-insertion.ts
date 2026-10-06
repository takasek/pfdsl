import { insertDefinition } from "@pfdsl/core";
import {
	findDefinitionEditTarget,
	findUndefinedNodeKind,
	nodeIdAtSourcePosition,
} from "@pfdsl/editor";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";

const EDIT_DEFINITION_COMMAND = "pfdsl._editInsertedDefinition";

export function registerDefInsertion(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			EDIT_DEFINITION_COMMAND,
			async (uri: string, kind: "artifact" | "process", id: string) => {
				const document = vscode.workspace.textDocuments.find(
					(doc) =>
						doc.uri.toString() === uri &&
						!doc.isClosed &&
						doc.languageId === LANGUAGE_ID,
				);
				if (
					!document ||
					!findDefinitionEditTarget(analyzeDocument(document), kind, id)
				)
					return;
				const existing = vscode.window.visibleTextEditors.find(
					(editor) => editor.document.uri.toString() === uri,
				);
				const options: vscode.TextDocumentShowOptions = {
					preserveFocus: false,
				};
				if (existing?.viewColumn !== undefined)
					options.viewColumn = existing.viewColumn;
				let editor: vscode.TextEditor;
				try {
					editor = await vscode.window.showTextDocument(document, options);
				} catch {
					return;
				}
				if (document.isClosed || editor.document !== document) return;
				// Showing the editor is asynchronous; use its current snapshot rather
				// than positions computed before the WorkspaceEdit or while it opened.
				const target = findDefinitionEditTarget(
					analyzeDocument(document),
					kind,
					id,
				);
				if (!target) return;
				const { start, end } = target.labelRange;
				const range = new vscode.Range(
					new vscode.Position(start.line - 1, start.column - 1),
					new vscode.Position(end.line - 1, end.column - 1),
				);
				editor.selection = new vscode.Selection(range.start, range.end);
				editor.revealRange(range);
				const hint = `Edit the label for ${kind} "${id}".`;
				vscode.window.showInformationMessage(
					target.needsCriteria
						? `${hint} Add criteria describing how this produced artifact is judged complete (W002).`
						: hint,
				);
			},
		),
	);

	const provider: vscode.CodeActionProvider = {
		provideCodeActions(document, range) {
			if (document.languageId !== LANGUAGE_ID) return;
			const model = analyzeDocument(document);
			const source = document.getText();
			const id = nodeIdAtSourcePosition(model, source, range.start);
			if (id === undefined) return;
			const { frontmatter, nodeKinds, bodyStartLine } = model;
			const kind = findUndefinedNodeKind(nodeKinds, frontmatter, id);
			if (!kind) return;

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
			action.command = {
				command: EDIT_DEFINITION_COMMAND,
				title: "Edit inserted definition",
				arguments: [document.uri.toString(), kind, id],
			};
			return [action];
		},
	};

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(LANGUAGE_ID, provider, {
			providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
		}),
	);
}
