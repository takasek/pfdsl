import { Graphviz } from "@hpcc-js/wasm";
import { formatEdges, sortEdges } from "@pfdsl/core";
import { exportDot } from "@pfdsl/graphviz-exporter";
import { extractMetadata, toTsv } from "@pfdsl/metadata-exporter";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";

let gv: Awaited<ReturnType<typeof Graphviz.load>> | null = null;
async function getGraphviz() {
	if (!gv) gv = await Graphviz.load();
	return gv;
}

const outputChannel = vscode.window.createOutputChannel("PFDSL");

export function registerExport(context: vscode.ExtensionContext): void {
	context.subscriptions.push(outputChannel);
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.export", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== LANGUAGE_ID) {
				vscode.window.showInformationMessage("Open a .pfdsl file first.");
				return;
			}
			const doc = editor.document;

			const FORMATS = [
				{ label: "DOT", description: ".dot" },
				{ label: "SVG", description: ".svg" },
				{ label: "TSV", description: ".tsv" },
				{ label: "All (DOT + SVG + TSV)", description: "all" },
			] as const;

			const pick = await vscode.window.showQuickPick([...FORMATS], {
				title: "Export as…",
			});
			if (!pick) return;

			const { graph, frontmatter, diagnostics } = analyzeDocument(doc);
			if (diagnostics.some((d) => d.severity === "error")) {
				vscode.window.showErrorMessage("Fix errors before exporting.");
				return;
			}

			const dot = exportDot(graph, frontmatter);
			const tsvContent = toTsv(extractMetadata(graph, frontmatter));
			const base = doc.uri.path.replace(/\.pfdsl$/, "");

			if (pick.description === "all") {
				const dirUri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(`${base}.dot`),
					filters: { DOT: ["dot"] },
					title: "Save base path (extensions added automatically)",
				});
				if (!dirUri) return;
				const stem = dirUri.fsPath.replace(/\.[^.]+$/, "");
				const g = await getGraphviz();
				await Promise.all([
					vscode.workspace.fs.writeFile(
						vscode.Uri.file(`${stem}.dot`),
						Buffer.from(dot, "utf8"),
					),
					vscode.workspace.fs.writeFile(
						vscode.Uri.file(`${stem}.svg`),
						Buffer.from(g.dot(dot, "svg"), "utf8"),
					),
					vscode.workspace.fs.writeFile(
						vscode.Uri.file(`${stem}.tsv`),
						Buffer.from(tsvContent, "utf8"),
					),
				]);
				vscode.window.showInformationMessage(
					`Exported: ${stem}.dot / .svg / .tsv`,
				);
				return;
			}

			const ext = pick.description;
			const saveUri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(base + ext),
				filters: { [pick.label]: [ext.slice(1)] },
			});
			if (!saveUri) return;

			let content: Uint8Array;
			if (ext === ".dot") {
				content = Buffer.from(dot, "utf8");
			} else if (ext === ".svg") {
				const g = await getGraphviz();
				content = Buffer.from(g.dot(dot, "svg"), "utf8");
			} else {
				content = Buffer.from(tsvContent, "utf8");
			}
			await vscode.workspace.fs.writeFile(saveUri, content);
			vscode.window.showInformationMessage(`Exported: ${saveUri.fsPath}`);
		}),

		vscode.commands.registerCommand("pfdsl.normalize", () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== LANGUAGE_ID) {
				vscode.window.showInformationMessage("Open a .pfdsl file first.");
				return;
			}
			const { edges, graph, diagnostics } = analyzeDocument(editor.document);
			if (diagnostics.some((d) => d.severity === "error")) {
				vscode.window.showErrorMessage("Fix errors before normalizing.");
				return;
			}
			outputChannel.clear();
			outputChannel.appendLine(formatEdges(sortEdges(edges, graph)));
			outputChannel.show(true);
		}),
	);
}
