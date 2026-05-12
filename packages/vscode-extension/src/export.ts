import { Graphviz } from "@hpcc-js/wasm";
import { exportDot } from "@pfdsl/graphviz-exporter";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";

let gv: Awaited<ReturnType<typeof Graphviz.load>> | null = null;
async function getGraphviz() {
	if (!gv) gv = await Graphviz.load();
	return gv;
}

export function registerExport(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.export", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== LANGUAGE_ID) {
				vscode.window.showInformationMessage("Open a .pfdsl file first.");
				return;
			}
			const doc = editor.document;

			const pick = await vscode.window.showQuickPick(
				[
					{ label: "DOT", description: ".dot" },
					{ label: "SVG", description: ".svg" },
				],
				{ title: "Export as…" },
			);
			if (!pick) return;

			const { graph, frontmatter, diagnostics } = analyzeDocument(doc);
			if (diagnostics.some((d) => d.severity === "error")) {
				vscode.window.showErrorMessage("Fix errors before exporting.");
				return;
			}

			const dot = exportDot(graph, frontmatter);
			const ext = pick.description!;
			const baseName = doc.uri.path.replace(/\.pfdsl$/, "") + ext;
			const saveUri = await vscode.window.showSaveDialog({
				defaultUri: vscode.Uri.file(baseName),
				filters: { [pick.label]: [ext.slice(1)] },
			});
			if (!saveUri) return;

			let content: Uint8Array;
			if (ext === ".dot") {
				content = Buffer.from(dot, "utf8");
			} else {
				const g = await getGraphviz();
				content = Buffer.from(g.dot(dot, "svg"), "utf8");
			}
			await vscode.workspace.fs.writeFile(saveUri, content);
			vscode.window.showInformationMessage(`Exported: ${saveUri.fsPath}`);
		}),
	);
}
