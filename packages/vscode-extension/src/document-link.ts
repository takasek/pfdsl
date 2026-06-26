import * as vscode from "vscode";
import { LANGUAGE_ID } from "./analyze.js";
import { extractDocumentLinks } from "./document-link-logic.js";

export function registerDocumentLinks(context: vscode.ExtensionContext): void {
	const provider: vscode.DocumentLinkProvider = {
		provideDocumentLinks(doc) {
			const links = extractDocumentLinks(doc.getText(), doc.uri.fsPath);
			return links.map(({ line, startChar, endChar, target }) => {
				const range = new vscode.Range(line, startChar, line, endChar);
				const targetUri = target.startsWith("file://")
					? vscode.Uri.file(target.slice("file://".length))
					: vscode.Uri.parse(target);
				return new vscode.DocumentLink(range, targetUri);
			});
		},
	};

	context.subscriptions.push(
		vscode.languages.registerDocumentLinkProvider(LANGUAGE_ID, provider),
	);
}
