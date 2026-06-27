import { hasErrors, sort } from "@pfdsl/core";
import * as vscode from "vscode";
import { LANGUAGE_ID } from "./analyze.js";

const SORT_KEYS = [
	{ label: "topological", description: "Flow order — inputs before outputs" },
	{ label: "group", description: "Group field, then original order" },
	{ label: "index", description: "Explicit index: field value" },
	{ label: "id", description: "Alphabetical by node id" },
] as const;

type SortKeyLabel = (typeof SORT_KEYS)[number]["label"];

export function registerSortMeta(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.sortMeta", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== LANGUAGE_ID) return;

			const picks = await vscode.window.showQuickPick(
				SORT_KEYS.map((k) => ({ ...k, picked: false })),
				{
					placeHolder:
						"Select sort keys in priority order (first selected = primary)",
					canPickMany: true,
				},
			);
			if (!picks || picks.length === 0) return;

			const by = picks.map((p) => p.label as SortKeyLabel);
			const source = editor.document.getText();
			const { output, changed, diagnostics } = sort(source, { by });
			if (hasErrors(diagnostics) || !changed) return;

			const fullRange = new vscode.Range(
				editor.document.positionAt(0),
				editor.document.positionAt(source.length),
			);
			await editor.edit((eb) => eb.replace(fullRange, output));
		}),
	);
}
