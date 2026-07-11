import { formatEdges, sortEdges } from "@pfdsl/core";
import { exportDot, svgToBinary } from "@pfdsl/graphviz-exporter";
import { extractMetadata, toTsv } from "@pfdsl/metadata-exporter";
import { renderDotToSvg } from "@pfdsl/preview-engine";
import * as vscode from "vscode";
import {
	analyzeDocument,
	resolveEffectiveFrontmatterForUri,
} from "./analyze.js";
import { requireActivePfdslEditor } from "./utils.js";

const outputChannel = vscode.window.createOutputChannel("PFDSL");

export function registerExport(
	context: vscode.ExtensionContext,
	getActivePreviewDoc: () => vscode.TextDocument | undefined,
): void {
	context.subscriptions.push(outputChannel);
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.export", async () => {
			const doc = requireActivePfdslEditor()?.document ?? getActivePreviewDoc();
			if (!doc) {
				vscode.window.showInformationMessage("Open a .pfdsl file first.");
				return;
			}

			const FORMATS = [
				{ label: "DOT", description: ".dot" },
				{ label: "SVG", description: ".svg" },
				{ label: "PDF", description: ".pdf" },
				{ label: "PNG", description: ".png" },
				{ label: "TSV", description: ".tsv" },
				{ label: "All (DOT + SVG + PDF + PNG + TSV)", description: "all" },
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

			const effectiveFrontmatter = resolveEffectiveFrontmatterForUri(
				doc.uri,
				frontmatter,
			);
			const dot = exportDot(graph, effectiveFrontmatter);
			const tsvContent = toTsv(extractMetadata(graph, effectiveFrontmatter));
			const base = doc.uri.path.replace(/\.pfdsl$/, "");

			async function writeFile(
				path: string,
				content: string | Uint8Array,
			): Promise<void> {
				await vscode.workspace.fs.writeFile(
					vscode.Uri.file(path),
					typeof content === "string" ? Buffer.from(content, "utf8") : content,
				);
			}

			if (pick.description === "all") {
				const dirUri = await vscode.window.showSaveDialog({
					defaultUri: vscode.Uri.file(`${base}.dot`),
					filters: { DOT: ["dot"] },
					title: "Save base path (extensions added automatically)",
				});
				if (!dirUri) return;
				const stem = dirUri.fsPath.replace(/\.[^.]+$/, "");

				const svg = await renderDotToSvg(dot);
				const coreWrites = [
					writeFile(`${stem}.dot`, dot),
					writeFile(`${stem}.svg`, svg),
					writeFile(`${stem}.tsv`, tsvContent),
				];

				const [pdfResult, pngResult] = await Promise.allSettled([
					svgToBinary(svg, "pdf"),
					svgToBinary(svg, "png"),
				]);

				const binaryWrites: Promise<void>[] = [];
				const failed: string[] = [];
				if (pdfResult.status === "fulfilled") {
					binaryWrites.push(writeFile(`${stem}.pdf`, pdfResult.value));
				} else {
					failed.push("PDF");
				}
				if (pngResult.status === "fulfilled") {
					binaryWrites.push(writeFile(`${stem}.png`, pngResult.value));
				} else {
					failed.push("PNG");
				}

				await Promise.all([...coreWrites, ...binaryWrites]);

				if (failed.length > 0) {
					vscode.window.showWarningMessage(
						`Exported: ${stem}.* (${failed.join(", ")} skipped — puppeteer required)`,
					);
				} else {
					vscode.window.showInformationMessage(
						`Exported: ${stem}.dot / .svg / .pdf / .png / .tsv`,
					);
				}
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
