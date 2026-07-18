import type * as vscode from "vscode";
import { clearAnalyzeCache } from "./analyze.js";
import { registerCodeLens } from "./codelens.js";
import { registerConnectorEditing } from "./connector.js";
import { registerDiagnostics } from "./diagnostics.js";
import { registerDiff } from "./diff.js";
import { registerDocumentLinks } from "./document-link.js";
import { registerExport } from "./export.js";
import { registerFormatter } from "./format.js";
import { registerHover } from "./hover.js";
import { registerDefinitionJump } from "./jump.js";
import { registerPreview } from "./preview.js";
import { registerSortMeta } from "./sort-meta.js";

export function activate(context: vscode.ExtensionContext): void {
	registerDiagnostics(context);
	registerFormatter(context);
	registerHover(context);
	registerCodeLens(context);
	registerDocumentLinks(context);
	const { postDiff, getActivePreviewDoc } = registerPreview(context);
	registerExport(context, getActivePreviewDoc);
	registerDiff(context, postDiff);
	registerDefinitionJump(context);
	registerSortMeta(context);
	registerConnectorEditing(context);
}

export function deactivate(): void {
	clearAnalyzeCache();
}
