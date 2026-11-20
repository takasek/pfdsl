import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
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

function displayPath(uri: vscode.Uri): string {
	return uri.scheme === "file" ? uri.fsPath : uri.toString();
}

function fileNotFound(error: unknown): boolean {
	return (
		error instanceof Error && "code" in error && error.code === "FileNotFound"
	);
}

async function createOutput(uri: vscode.Uri, bytes: Uint8Array): Promise<void> {
	// Stage the bytes before creating the visible output. VS Code's writeFile
	// has no exclusive-create flag for providers.
	const directory = uri.path.slice(0, uri.path.lastIndexOf("/") + 1);
	const staging = uri.with({
		path: `${directory}.pfdsl-${randomUUID()}.tmp`,
	});
	let moved = false;
	try {
		await vscode.workspace.fs.writeFile(staging, bytes);
		if (uri.scheme === "file" && !vscode.env.remoteName) {
			await copyFile(staging.fsPath, uri.fsPath, constants.COPYFILE_EXCL);
		} else {
			await vscode.workspace.fs.rename(staging, uri, { overwrite: false });
			moved = true;
		}
	} finally {
		if (!moved) {
			try {
				await vscode.workspace.fs.delete(staging);
			} catch (error) {
				if (!fileNotFound(error)) {
					vscode.window.showWarningMessage(
						`Could not remove temporary export file ${displayPath(staging)}: ${error}`,
					);
				}
			}
		}
	}
}

async function existingOutputs(
	targets: Iterable<vscode.Uri>,
): Promise<Set<vscode.Uri>> {
	const existing = new Set<vscode.Uri>();
	for (const uri of targets) {
		try {
			await vscode.workspace.fs.stat(uri);
			existing.add(uri);
		} catch (error) {
			if (fileNotFound(error)) continue;
			throw new Error(`Cannot inspect ${displayPath(uri)}: ${error}`);
		}
	}
	return existing;
}

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

			if (pick.description === "all") {
				const selected = await vscode.window.showSaveDialog({
					defaultUri: doc.uri.with({ path: `${base}.dot` }),
					filters: { DOT: ["dot"] },
					title: "Save base path (extensions added automatically)",
				});
				if (!selected) return;
				const stem = exportStem(selected.path);
				const targets = new Map(
					exportFormats.map(
						(format) =>
							[format, selected.with({ path: `${stem}.${format}` })] as const,
					),
				);
				let existing: Set<vscode.Uri>;
				try {
					existing = await existingOutputs(targets.values());
				} catch (error) {
					vscode.window.showErrorMessage(String(error));
					return;
				}
				if (existing.size > 0) {
					const choice = await vscode.window.showWarningMessage(
						"Replace the following export files?",
						{ modal: true, detail: [...existing].map(displayPath).join("\n") },
						"Replace",
					);
					if (choice !== "Replace") return;
				}

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
						const target = targets.get(format)!;
						if (existing.has(target)) {
							await vscode.workspace.fs.writeFile(target, bytes);
						} else {
							await createOutput(target, bytes);
						}
						return displayPath(target);
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
