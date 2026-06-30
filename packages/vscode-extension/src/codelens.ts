import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";
import { RUN_COMMAND } from "./hover-logic.js";

const COMMAND_LINE_RE = /^\s+command:\s+(.+)$/;

export function registerCodeLens(context: vscode.ExtensionContext): void {
	const provider: vscode.InlayHintsProvider = {
		provideInlayHints(doc) {
			const { frontmatter, bodyStartLine } = analyzeDocument(doc);
			if (!frontmatter?.process) return [];

			const processCommands = new Set<string>();
			for (const meta of Object.values(frontmatter.process)) {
				if (meta?.command) processCommands.add(meta.command);
			}
			if (processCommands.size === 0) return [];

			const hints: vscode.InlayHint[] = [];
			const docUri = doc.uri.toString();

			for (let i = 0; i < bodyStartLine - 1; i++) {
				const lineText = doc.lineAt(i).text;
				const match = lineText.match(COMMAND_LINE_RE);
				if (!match) continue;

				const rawValue = match[1]!.trim().replace(/^["']|["']$/g, "");
				if (!processCommands.has(rawValue)) continue;

				const part = new vscode.InlayHintLabelPart("▶ run");
				part.command = {
					command: RUN_COMMAND,
					arguments: [rawValue, docUri, frontmatter.basePath],
					title: "Run command",
				};

				const hint = new vscode.InlayHint(
					new vscode.Position(i, lineText.length),
					[part],
				);
				hint.paddingLeft = true;
				hints.push(hint);
			}

			return hints;
		},
	};

	context.subscriptions.push(
		vscode.languages.registerInlayHintsProvider(LANGUAGE_ID, provider),
	);
}
