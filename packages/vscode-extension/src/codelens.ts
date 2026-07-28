import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";
import { declaredCommands, runHintAnchors } from "./codelens-logic.js";
import { RUN_COMMAND } from "./hover-logic.js";

export function registerCodeLens(context: vscode.ExtensionContext): void {
	const provider: vscode.InlayHintsProvider = {
		provideInlayHints(doc) {
			const { frontmatter, bodyStartLine } = analyzeDocument(doc);
			if (!frontmatter?.process) return [];

			const docUri = doc.uri.toString();
			const anchors = runHintAnchors(
				doc.getText().split("\n"),
				bodyStartLine,
				declaredCommands(frontmatter.process),
			);

			return anchors.map(({ line, column, command }) => {
				const part = new vscode.InlayHintLabelPart("▶ run");
				part.command = {
					command: RUN_COMMAND,
					arguments: [command, docUri, frontmatter.basePath],
					title: "Run command",
				};
				const hint = new vscode.InlayHint(new vscode.Position(line, column), [
					part,
				]);
				hint.paddingLeft = true;
				return hint;
			});
		},
	};

	context.subscriptions.push(
		vscode.languages.registerInlayHintsProvider(LANGUAGE_ID, provider),
	);
}
