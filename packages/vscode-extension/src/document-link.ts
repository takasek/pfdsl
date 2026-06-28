import * as vscode from "vscode";
import { LANGUAGE_ID } from "./analyze.js";
import { extractDocumentLinks } from "./document-link-logic.js";

const OPEN_DIR_COMMAND = "pfdsl._openDirLocation";

async function expandDirectory(dirUri: vscode.Uri): Promise<string[]> {
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(dirUri);
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const [name, type] of entries) {
		if (type === vscode.FileType.File) {
			files.push(vscode.Uri.joinPath(dirUri, name).fsPath);
		}
	}
	if (files.length === 0) {
		for (const [name, type] of entries) {
			if (type === vscode.FileType.Directory) {
				const sub = await expandDirectory(vscode.Uri.joinPath(dirUri, name));
				files.push(...sub);
			}
		}
	}
	return files;
}

export function registerDocumentLinks(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			OPEN_DIR_COMMAND,
			async (dirFsPath: string) => {
				const dirUri = vscode.Uri.file(dirFsPath);
				const children = await expandDirectory(dirUri);
				if (children.length === 0) {
					vscode.window.showWarningMessage(`No files found in ${dirFsPath}`);
					return;
				}
				if (children.length === 1) {
					await vscode.window.showTextDocument(vscode.Uri.file(children[0]!));
					return;
				}
				const items = children.map((c) => ({
					label: c.split("/").pop() ?? c,
					description: c,
					fsPath: c,
				}));
				const selected = await vscode.window.showQuickPick(items, {
					placeHolder: "Open file…",
				});
				if (selected) {
					await vscode.window.showTextDocument(
						vscode.Uri.file(selected.fsPath),
					);
				}
			},
		),
	);

	const provider: vscode.DocumentLinkProvider = {
		async provideDocumentLinks(doc) {
			const links = extractDocumentLinks(doc.getText(), doc.uri.fsPath);
			return await Promise.all(
				links.map(async ({ line, startChar, endChar, target }) => {
					const range = new vscode.Range(line, startChar, line, endChar);
					if (target.startsWith("file://")) {
						const fsPath = target.slice("file://".length);
						const uri = vscode.Uri.file(fsPath);
						let stat: vscode.FileStat | undefined;
						try {
							stat = await vscode.workspace.fs.stat(uri);
						} catch {
							// treat as file
						}
						if (stat?.type === vscode.FileType.Directory) {
							const args = encodeURIComponent(JSON.stringify([fsPath]));
							return new vscode.DocumentLink(
								range,
								vscode.Uri.parse(`command:${OPEN_DIR_COMMAND}?${args}`),
							);
						}
						return new vscode.DocumentLink(range, uri);
					}
					return new vscode.DocumentLink(range, vscode.Uri.parse(target));
				}),
			);
		},
	};

	context.subscriptions.push(
		vscode.languages.registerDocumentLinkProvider(LANGUAGE_ID, provider),
	);
}
