import * as vscode from "vscode";
import { LANGUAGE_ID } from "./analyze.js";
import { extractDocumentLinks } from "./document-link-logic.js";
import { type DirectoryAccess, expandDirectory } from "./expand-directory.js";

const OPEN_DIR_COMMAND = "pfdsl._openDirLocation";

/** The vscode filesystem, shaped for expandDirectory: fsPaths in, fsPaths out. */
const workspaceDirectoryAccess: DirectoryAccess = {
	read: async (path) =>
		(await vscode.workspace.fs.readDirectory(vscode.Uri.file(path))).map(
			([name, type]) => ({
				name,
				isDirectory: type === vscode.FileType.Directory,
			}),
		),
	join: (path, name) => vscode.Uri.joinPath(vscode.Uri.file(path), name).fsPath,
};

export function registerDocumentLinks(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(
			OPEN_DIR_COMMAND,
			async (dirFsPath: string) => {
				const children = await expandDirectory(
					workspaceDirectoryAccess,
					dirFsPath,
				);
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
							const link = new vscode.DocumentLink(
								range,
								vscode.Uri.parse(`command:${OPEN_DIR_COMMAND}?${args}`),
							);
							link.tooltip = "Open file in folder…";
							return link;
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
