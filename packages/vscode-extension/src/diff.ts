import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { analyze, type DiffReport, diffGraphs } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument } from "./analyze.js";
import { requireActivePfdslEditor } from "./utils.js";

export function registerDiff(
	context: vscode.ExtensionContext,
	postDiff: (report: DiffReport | null) => void,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.diff", async () => {
			const editor = requireActivePfdslEditor();
			if (!editor) return;

			const pick = await vscode.window.showQuickPick(
				[
					{
						label: "$(git-commit) Compare with git ref...",
						id: "git" as const,
					},
					{ label: "$(file) Compare with file...", id: "file" as const },
				],
				{ title: "PFDSL: Diff" },
			);
			if (!pick) return;

			let otherContent: string;

			if (pick.id === "git") {
				const ref = await vscode.window.showInputBox({
					title: "Compare with git ref",
					value: "HEAD",
					prompt: "Commit hash, branch, tag, or HEAD~N",
				});
				if (ref === undefined) return;

				const workspaceFolder = vscode.workspace.getWorkspaceFolder(
					editor.document.uri,
				);
				if (!workspaceFolder) {
					vscode.window.showErrorMessage("PFDSL: No workspace folder found.");
					return;
				}
				const workspaceRoot = workspaceFolder.uri.fsPath;
				const relPath = relative(workspaceRoot, editor.document.uri.fsPath);

				try {
					otherContent = execSync(`git show ${ref}:${relPath}`, {
						cwd: workspaceRoot,
						encoding: "utf-8",
					});
				} catch {
					vscode.window.showErrorMessage(
						`PFDSL: File not found at ref "${ref}" (${relPath})`,
					);
					return;
				}
			} else {
				const uris = await vscode.window.showOpenDialog({
					filters: { "PFDSL files": ["pfdsl"] },
					canSelectMany: false,
					title: "Compare with...",
				});
				if (!uris || uris.length === 0) return;
				try {
					otherContent = readFileSync(uris[0]!.fsPath, "utf-8");
				} catch (e) {
					vscode.window.showErrorMessage(
						`PFDSL: Failed to read file: ${(e as Error).message}`,
					);
					return;
				}
			}

			const otherResult = analyze(otherContent);
			const fatal = otherResult.diagnostics.find((d) => d.severity === "error");
			if (fatal) {
				vscode.window.showErrorMessage(
					`PFDSL: Parse error in comparison target: ${fatal.message}`,
				);
				return;
			}

			const currentGraph = analyzeDocument(editor.document).graph;
			const report = diffGraphs(currentGraph, otherResult.graph);

			await vscode.commands.executeCommand("pfdsl.preview");
			postDiff(report);
		}),

		vscode.commands.registerCommand("pfdsl.clearDiff", () => {
			postDiff(null);
		}),
	);
}
