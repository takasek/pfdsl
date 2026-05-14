import {
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
			const body = buildFormattedBody(doc, "flat");
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
			const frontmatterLines = frontmatter
				? frontmatter.split("\n").length - 1
				: 0;

			// selection is entirely in frontmatter → nothing to do
			if (range.end.line < frontmatterLines) return [];

			const body = buildFormattedBody(doc, "flat");
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
						label: "Flat",
						description: "One edge per line  (A >> P,  P -> B)",
						mode: "flat" as const,
					},
					{
						label: "Flows",
						description: "Per-process grouped  (A >> P -> B)",
						mode: "flows" as const,
					},
				],
				{ placeHolder: "Choose format style" },
			);
			if (!pick) return;

			const doc = editor.document;
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
		}),
	);
}
