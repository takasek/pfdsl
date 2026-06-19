import { formatEdges, sortEdges } from "@pfdsl/core";
import { exportDot, svgToBinary } from "@pfdsl/graphviz-exporter";
import { extractMetadata, toTsv } from "@pfdsl/metadata-exporter";
import { renderDotToSvg } from "@pfdsl/preview-engine";
import * as vscode from "vscode";
import { analyzeDocument } from "./analyze.js";
import { requireActivePfdslEditor } from "./utils.js";

const outputChannel = vscode.window.createOutputChannel("PFDSL");

export function registerExport(context: vscode.ExtensionContext): void {
	context.subscriptions.push(outputChannel);
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.export", async () => {
			const editor = requireActivePfdslEditor();
			if (!editor) return;
			const doc = editor.document;

			const FORMATS = [
				{ label: "DOT", description: ".dot" },
				{ label: "SVG", description: ".svg" },
				{ label: "PDF", description: ".pdf" },
				{ label: "PNG", description: ".png" },
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
				await Promise.all([
					vscode.workspace.fs.writeFile(
						vscode.Uri.file(`${stem}.dot`),
						Buffer.from(dot, "utf8"),
					),
					vscode.workspace.fs.writeFile(
						vscode.Uri.file(`${stem}.svg`),
						Buffer.from(await renderDotToSvg(dot), "utf8"),
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
				content = Buffer.from(await renderDotToSvg(dot), "utf8");
			} else if (ext === ".pdf" || ext === ".png") {
				const svg = await renderDotToSvg(dot);
				try {
					content = await svgToBinary(svg, ext.slice(1) as "pdf" | "png");
				} catch (e) {
					vscode.window.showErrorMessage(
						e instanceof Error ? e.message : String(e),
					);
					return;
				}
			} else {
				content = Buffer.from(tsvContent, "utf8");
			}
			await vscode.workspace.fs.writeFile(saveUri, content);
			vscode.window.showInformationMessage(`Exported: ${saveUri.fsPath}`);
		}),

		vscode.commands.registerCommand("pfdsl.normalize", () => {
			const editor = requireActivePfdslEditor();
			if (!editor) return;
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
