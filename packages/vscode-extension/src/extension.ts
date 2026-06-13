import type * as vscode from "vscode";
import { clearAnalyzeCache } from "./analyze.js";
import { registerDiagnostics } from "./diagnostics.js";
import { registerDiff } from "./diff.js";
import { registerExport } from "./export.js";
import { registerFormatter } from "./format.js";
import { registerHover } from "./hover.js";
import { registerDefinitionJump } from "./jump.js";
import { registerPreview } from "./preview.js";

export function activate(context: vscode.ExtensionContext): void {
	registerDiagnostics(context);
	registerFormatter(context);
	registerHover(context);
	const { postDiff } = registerPreview(context);
	registerExport(context);
	registerDiff(context, postDiff);
	registerDefinitionJump(context);
}

export function deactivate(): void {
	clearAnalyzeCache();
}
