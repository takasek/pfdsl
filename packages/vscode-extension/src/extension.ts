import type * as vscode from "vscode";
import { clearAnalyzeCache } from "./analyze.js";
import { registerDiagnostics } from "./diagnostics.js";
import { registerFormatter } from "./format.js";
import { registerHover } from "./hover.js";
import { registerPreview } from "./preview.js";

export function activate(context: vscode.ExtensionContext): void {
	registerDiagnostics(context);
	registerFormatter(context);
	registerHover(context);
	registerPreview(context);
}

export function deactivate(): void {
	clearAnalyzeCache();
}
