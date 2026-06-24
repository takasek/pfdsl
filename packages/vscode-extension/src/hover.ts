import { ID_PATTERN } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";
import { buildHoverLines } from "./hover-logic.js";
import { findFrontmatterDefinition } from "./jump.js";

export { buildHoverLines } from "./hover-logic.js";

const GOTO_COMMAND = "pfdsl._gotoNodeDefinition";

export function registerHover(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			GOTO_COMMAND,
			(docUriStr: string, nodeId: string) => {
				const uri = vscode.Uri.parse(docUriStr);
				vscode.workspace.openTextDocument(uri).then((doc) => {
					const pos = findFrontmatterDefinition(doc, nodeId);
					if (!pos) {
						vscode.window.showInformationMessage(
							`No frontmatter definition found for "${nodeId}"`,
						);
						return;
					}
					const defRange = new vscode.Range(
						pos,
						pos.translate(0, nodeId.length),
					);
					const existing = vscode.window.visibleTextEditors.find(
						(e) => e.document.uri.toString() === docUriStr,
					);
					if (existing) {
						existing.selection = new vscode.Selection(
							pos,
							pos.translate(0, nodeId.length),
						);
						existing.revealRange(defRange);
						vscode.window.showTextDocument(doc, {
							viewColumn: existing.viewColumn,
							preserveFocus: false,
						});
					} else {
						vscode.window.showTextDocument(doc, { selection: defRange });
					}
				});
			},
		),
	);

	const provider: vscode.HoverProvider = {
		provideHover(doc, pos) {
			const range = doc.getWordRangeAtPosition(pos, ID_PATTERN);
			if (!range) return null;
			const id = doc.getText(range);

			const { frontmatter, nodeKinds } = analyzeDocument(doc);
			const kind = nodeKinds.get(id);
			if (!kind) return null;

			const lines = buildHoverLines(id, kind, frontmatter);

			const args = encodeURIComponent(JSON.stringify([doc.uri.toString(), id]));
			lines.push(`[→ Go to definition](command:${GOTO_COMMAND}?${args})`);

			const md = new vscode.MarkdownString(lines.join("  \n"));
			md.isTrusted = { enabledCommands: [GOTO_COMMAND] };
			return new vscode.Hover(md, range);
		},
	};

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(LANGUAGE_ID, provider),
	);
}
