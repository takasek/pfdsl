import { ID_PATTERN } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";
import { buildHoverLines } from "./hover-logic.js";
import { findFrontmatterDefinition } from "./jump.js";

export { buildHoverLines } from "./hover-logic.js";

const GOTO_COMMAND = "pfdsl._gotoNodeDefinition";
const FIND_COMMAND = "editor.actions.findWithArgs";
const RUN_COMMAND = "pfdsl._runProcessCommand";

export function registerHover(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(RUN_COMMAND, (command: string) => {
			const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const options: vscode.TerminalOptions = { name: "pfdsl" };
			if (workspaceRoot) options.cwd = workspaceRoot;
			const terminal = vscode.window.createTerminal(options);
			terminal.show();
			terminal.sendText(command);
		}),
	);

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
						const vc = existing.viewColumn;
						if (vc !== undefined) {
							vscode.window.showTextDocument(doc, {
								viewColumn: vc,
								preserveFocus: false,
							});
						}
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

			const gotoArgs = encodeURIComponent(
				JSON.stringify([doc.uri.toString(), id]),
			);
			const findArgs = encodeURIComponent(
				JSON.stringify({ searchString: id, isRegex: false }),
			);
			const linkParts = [
				`[→ Go to definition](command:${GOTO_COMMAND}?${gotoArgs})`,
				`[⌕ Find all](command:${FIND_COMMAND}?${findArgs})`,
			];
			const processCommand = frontmatter?.process?.[id]?.command;
			if (processCommand) {
				const runArgs = encodeURIComponent(JSON.stringify([processCommand]));
				linkParts.push(`[▶ Run command](command:${RUN_COMMAND}?${runArgs})`);
			}
			const linkLine = linkParts.join("  ");
			// Insert links after header+separator (index 2), before table rows
			lines.splice(2, 0, linkLine);

			const md = new vscode.MarkdownString(lines.join("  \n"));
			md.supportHtml = true;
			md.isTrusted = {
				enabledCommands: [GOTO_COMMAND, FIND_COMMAND, RUN_COMMAND],
			};
			return new vscode.Hover(md, range);
		},
	};

	context.subscriptions.push(
		vscode.languages.registerHoverProvider(LANGUAGE_ID, provider),
	);
}
