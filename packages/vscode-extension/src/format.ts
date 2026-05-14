import {
	format,
	formatAsFlows,
	formatEdges,
	hasErrors,
	sortEdges,
	sortIsolated,
} from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";

function extractFrontmatter(source: string): {
	frontmatter: string;
	body: string;
} {
	if (!source.startsWith("---")) return { frontmatter: "", body: source };
	const match = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
	if (!match) return { frontmatter: "", body: source };
	return { frontmatter: match[0], body: source.slice(match[0].length) };
}

function buildFormattedBody(
	doc: vscode.TextDocument,
	mode: "flat" | "flows",
): string | null {
	const { edges, graph, isolatedNodes, diagnostics } = analyzeDocument(doc);
	if (hasErrors(diagnostics)) return null;
	const sorted = sortEdges(edges, graph);
	const isolated = sortIsolated(isolatedNodes);
	return mode === "flows"
		? formatAsFlows(sorted, isolated)
		: formatEdges(sorted, isolated);
}

export function registerFormatter(context: vscode.ExtensionContext): void {
	const docProvider: vscode.DocumentFormattingEditProvider = {
		provideDocumentFormattingEdits(doc) {
			const source = doc.getText();
			const { frontmatter } = extractFrontmatter(source);
			const body = buildFormattedBody(doc, "flows");
			if (body === null) return [];
			const output = frontmatter + body;
			if (output === source) return [];
			const fullRange = new vscode.Range(
				doc.positionAt(0),
				doc.positionAt(source.length),
			);
			return [vscode.TextEdit.replace(fullRange, output)];
		},
	};

	const rangeProvider: vscode.DocumentRangeFormattingEditProvider = {
		provideDocumentRangeFormattingEdits(doc, range) {
			const source = doc.getText();
			const { frontmatter } = extractFrontmatter(source);
			const frontmatterLineCount = frontmatter
				? frontmatter.split("\n").length - 1
				: 0;

			// selection entirely in frontmatter → nothing to do
			if (range.end.line < frontmatterLineCount) return [];

			// Expand to full lines, clamped below the frontmatter
			const startLine = Math.max(range.start.line, frontmatterLineCount);
			const endLine = range.end.line;
			const selectedRange = new vscode.Range(
				new vscode.Position(startLine, 0),
				doc.lineAt(endLine).rangeIncludingLineBreak.end,
			);
			const selectedText = doc.getText(selectedRange);

			const { output, diagnostics } = format(selectedText, { style: "flows" });
			if (hasErrors(diagnostics)) return [];
			if (output === selectedText) return [];
			return [vscode.TextEdit.replace(selectedRange, output)];
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

			if (!sel.isEmpty) {
				// Format selection only
				const source = doc.getText();
				const { frontmatter } = extractFrontmatter(source);
				const frontmatterLineCount = frontmatter
					? frontmatter.split("\n").length - 1
					: 0;
				if (sel.end.line < frontmatterLineCount) return;
				const startLine = Math.max(sel.start.line, frontmatterLineCount);
				const selectedRange = new vscode.Range(
					new vscode.Position(startLine, 0),
					doc.lineAt(sel.end.line).rangeIncludingLineBreak.end,
				);
				const selectedText = doc.getText(selectedRange);
				const { output, diagnostics } = format(selectedText, {
					style: pick.mode,
				});
				if (hasErrors(diagnostics) || output === selectedText) return;
				await editor.edit((eb) => eb.replace(selectedRange, output));
			} else {
				// Format whole document
				const source = doc.getText();
				const { frontmatter } = extractFrontmatter(source);
				const body = buildFormattedBody(doc, pick.mode);
				if (body === null) return;
				const output = frontmatter + body;
				if (output === source) return;
				const fullRange = new vscode.Range(
					doc.positionAt(0),
					doc.positionAt(source.length),
				);
				await editor.edit((eb) => eb.replace(fullRange, output));
			}
		}),
	);
}
