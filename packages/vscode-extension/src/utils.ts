import * as vscode from "vscode";
import { LANGUAGE_ID } from "./analyze.js";

export function requireActivePfdslEditor(): vscode.TextEditor | undefined {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.languageId !== LANGUAGE_ID) {
		vscode.window.showInformationMessage("Open a .pfdsl file first.");
		return undefined;
	}
	return editor;
}
