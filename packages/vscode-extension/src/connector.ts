import { ID_PATTERN } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";
import {
	buildConnectorEdgeLine,
	type ConnectorDirection,
	type ConnectorKind,
	connectorKindsFor,
	insertConnectorEdge,
} from "./connector-logic.js";

const NEW_ID_ITEM = "$(add) New node ID…";

const DIRECTION_ITEMS: {
	label: string;
	description: string;
	value: ConnectorDirection;
}[] = [
	{
		label: "Before",
		description: "add an input source (>>/>>?)",
		value: "before",
	},
	{ label: "After", description: "add an output target (->)", value: "after" },
];

const CONNECTOR_LABELS: Record<ConnectorKind, string> = {
	">>": "Input (>>)",
	">>?": "Feedback (>>?)",
	"->": "Output (->)",
};

function nodeIdAtCursor(
	editor: vscode.TextEditor,
): { nodeId: string } | undefined {
	const { document: doc, selection } = editor;
	const range = doc.getWordRangeAtPosition(selection.active, ID_PATTERN);
	if (!range) return undefined;
	return { nodeId: doc.getText(range) };
}

export function registerConnectorEditing(
	context: vscode.ExtensionContext,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("pfdsl.addConnector", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== LANGUAGE_ID) return;

			const cursor = nodeIdAtCursor(editor);
			if (!cursor) {
				vscode.window.showInformationMessage(
					"Place the cursor on a node ID first.",
				);
				return;
			}
			const { nodeId } = cursor;

			const directionPick = await vscode.window.showQuickPick(DIRECTION_ITEMS, {
				placeHolder: `Add a connector ${nodeId === "" ? "" : `for "${nodeId}"`}`,
			});
			if (!directionPick) return;
			const direction = directionPick.value;

			const kinds = connectorKindsFor(direction);
			const connectorPick =
				kinds.length === 1
					? kinds[0]
					: await vscode.window
							.showQuickPick(
								kinds.map((k) => ({
									label: CONNECTOR_LABELS[k],
									connectorKind: k,
								})),
								{ placeHolder: "Select connector type" },
							)
							.then((pick) => pick?.connectorKind);
			if (!connectorPick) return;
			const connector = connectorPick;

			const { nodeKinds } = analyzeDocument(editor.document);
			const existingIds = [...nodeKinds.keys()]
				.filter((id) => id !== nodeId)
				.sort();
			const idPick = await vscode.window.showQuickPick(
				[NEW_ID_ITEM, ...existingIds],
				{ placeHolder: "Select the other node" },
			);
			if (!idPick) return;

			let otherId = idPick;
			if (idPick === NEW_ID_ITEM) {
				const fullIdPattern = new RegExp(`^(?:${ID_PATTERN.source})$`, "u");
				const input = await vscode.window.showInputBox({
					prompt: "New node ID",
					validateInput: (value) =>
						fullIdPattern.test(value) ? undefined : "Invalid node ID",
				});
				if (!input) return;
				otherId = input;
			}

			const edgeLine = buildConnectorEdgeLine(
				nodeId,
				direction,
				connector,
				otherId,
			);
			const source = editor.document.getText();
			const { text } = insertConnectorEdge(source, edgeLine);
			const fullRange = new vscode.Range(
				editor.document.positionAt(0),
				editor.document.positionAt(source.length),
			);
			await editor.edit((eb) => eb.replace(fullRange, text));
		}),
	);
}
