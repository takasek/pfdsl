import * as vscode from "vscode";
import { LANGUAGE_ID } from "./analyze.js";
import {
	clampSelectionToBody,
	computeFullDocumentFormatOutput,
	computeRangeFormatOutput,
	type FormatStyle,
} from "./format-logic.js";

function formatWholeDocument(
	doc: vscode.TextDocument,
	style: FormatStyle,
): vscode.TextEdit | null {
	const source = doc.getText();
	const output = computeFullDocumentFormatOutput(source, style);
	if (output === null) return null;
	const fullRange = new vscode.Range(
		doc.positionAt(0),
		doc.positionAt(source.length),
	);
	return vscode.TextEdit.replace(fullRange, output);
}

function formatSelection(
	doc: vscode.TextDocument,
	range: vscode.Range,
	style: FormatStyle,
): vscode.TextEdit | null {
	const source = doc.getText();
	const clamped = clampSelectionToBody(
		source,
		range.start.line,
		range.end.line,
	);
	if (!clamped) return null;
	const selectedRange = new vscode.Range(
		new vscode.Position(clamped.startLine, 0),
		doc.lineAt(clamped.endLine).rangeIncludingLineBreak.end,
	);
	const selectedText = doc.getText(selectedRange);
	const output = computeRangeFormatOutput(selectedText, style);
	if (output === null) return null;
	return vscode.TextEdit.replace(selectedRange, output);
}

export function registerFormatter(context: vscode.ExtensionContext): void {
	const docProvider: vscode.DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(doc) {
			const edit = formatWholeDocument(doc, "flows");
			return edit ? [edit] : [];
		},
	};

	const rangeProvider: vscode.DocumentRangeFormattingEditProvider = {
		provideDocumentRangeFormattingEdits(doc, range) {
			const edit = formatSelection(doc, range, "flows");
			return edit ? [edit] : [];
		},
	};

	context.subscriptions.push(
		vscode.languages.registerDocumentFormattingEditProvider(
			LANGUAGE_ID,
			docProvider,
		),
		vscode.languages.registerDocumentRangeFormattingEditProvider(
			LANGUAGE_ID,
			rangeProvider,
		),
		vscode.commands.registerCommand("pfdsl.format", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== LANGUAGE_ID) return;

			const pick = await vscode.window.showQuickPick(
				[
					{
						label: "Flows",
						description: "Per-process grouped  (A >> P -> B)",
						mode: "flows" as const,
					},
					{
						label: "Flat",
						description: "One edge per line  (A >> P,  P -> B)",
						mode: "flat" as const,
					},
				],
				{ placeHolder: "Choose format style" },
			);
			if (!pick) return;

			const doc = editor.document;
			const sel = editor.selection;

			const edit = sel.isEmpty
				? formatWholeDocument(doc, pick.mode)
				: formatSelection(doc, sel, pick.mode);
			if (!edit) return;
			await editor.edit((eb) => eb.replace(edit.range, edit.newText));
		}),
	);
}
