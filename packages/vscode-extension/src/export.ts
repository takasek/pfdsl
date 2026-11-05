import {
	computeExportSources,
	computeNormalizedEdgesOutput,
	exportFormats,
	runExports,
} from "@pfdsl/editor";
import { svgToBinary } from "@pfdsl/graphviz-exporter";
import { renderDotToSvg } from "@pfdsl/preview-engine";
import * as vscode from "vscode";
import {
	analyzeDocument,
	resolveEffectiveFrontmatterForUri,
} from "./analyze.js";
import { exportStem } from "./export-logic.js";
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
			const { dot, tsv: tsvContent } = computeExportSources(
				graph,
				effectiveFrontmatter,
			);
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
				const stem = exportStem(dirUri.fsPath);

				let svg: Promise<string> | undefined;
				const results = await runExports(
					exportFormats,
					async (format) => {
						if (format === "dot") return Buffer.from(dot, "utf8");
						if (format === "tsv") return Buffer.from(tsvContent, "utf8");
						svg ??= renderDotToSvg(dot);
						const content = await svg;
						return format === "svg"
							? Buffer.from(content, "utf8")
							: svgToBinary(content, format);
					},
					async (format, bytes) => {
						const path = `${stem}.${format}`;
						await writeFile(path, bytes);
						return path;
					},
				);
				const message = results
					.map(
						(result) =>
							`${result.format.toUpperCase()}: ${result.status === "saved" ? result.savedPath : `${result.status}: ${result.error}`}`,
					)
					.join("\n");
				outputChannel.appendLine(message);
				if (results.some((result) => result.status !== "saved")) {
					outputChannel.show(true);
					vscode.window.showWarningMessage(message);
				} else vscode.window.showInformationMessage(message);
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
			const output = computeNormalizedEdgesOutput(
				analyzeDocument(editor.document),
			);
			if (output === null) {
				vscode.window.showErrorMessage("Fix errors before normalizing.");
				return;
			}
			outputChannel.clear();
			outputChannel.appendLine(output);
			outputChannel.show(true);
		}),
	);
}
