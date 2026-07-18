import { ID_PATTERN } from "@pfdsl/core";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";
import {
	buildConnectorEdgeLine,
	type ConnectorKind,
	directionForKind,
	edgeAlreadyExists,
	insertConnectorEdge,
} from "./connector-logic.js";

const NEW_ID_ITEM = "$(add) New node ID…";

/** Labels show the resulting edge syntax directly so direction never needs a separate pick. */
const CONNECTOR_ITEMS: {
	connector: ConnectorKind;
	buildLabel: (nodeId: string) => string;
	description: string;
}[] = [
	{
		connector: ">>",
		buildLabel: (id) => `? >> ${id}`,
		description: "Add input (before this node)",
	},
	{
		connector: ">>?",
		buildLabel: (id) => `? >>? ${id}`,
		description: "Add feedback input (before this node)",
	},
	{
		connector: "->",
		buildLabel: (id) => `${id} -> ?`,
		description: "Add output (after this node)",
	},
];

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

			const connectorPick = await vscode.window.showQuickPick(
				CONNECTOR_ITEMS.map((item) => ({
					label: item.buildLabel(nodeId),
					description: item.description,
					connector: item.connector,
				})),
				{ placeHolder: `Choose the connector for "${nodeId}"` },
			);
			if (!connectorPick) return;
			const connector = connectorPick.connector;
			const direction = directionForKind(connector);

			const { nodeKinds, edges } = analyzeDocument(editor.document);
			const existingIds = [...nodeKinds.keys()]
				.filter((id) => id !== nodeId)
				.sort();
			const idPick = await vscode.window.showQuickPick(
				[
					{ label: NEW_ID_ITEM },
					...existingIds.map((id) => {
						const kind = nodeKinds.get(id);
						return kind ? { label: id, description: kind } : { label: id };
					}),
				],
				{ placeHolder: "Select the other node" },
			);
			if (!idPick) return;

			let otherId = idPick.label;
			if (idPick.label === NEW_ID_ITEM) {
				const fullIdPattern = new RegExp(`^(?:${ID_PATTERN.source})$`, "u");
				const input = await vscode.window.showInputBox({
					prompt: "New node ID",
					validateInput: (value) => {
						if (!fullIdPattern.test(value)) return "Invalid node ID";
						if (value === nodeId) return "Cannot connect a node to itself";
						return undefined;
					},
				});
				if (!input) return;
				otherId = input;
			}

			if (edgeAlreadyExists(edges, nodeId, connector, otherId)) {
				const choice = await vscode.window.showWarningMessage(
					`"${buildConnectorEdgeLine(nodeId, direction, connector, otherId)}" already exists.`,
					{ modal: true },
					"Add anyway",
				);
				if (choice !== "Add anyway") return;
			}

			const edgeLine = buildConnectorEdgeLine(
				nodeId,
				direction,
				connector,
				otherId,
			);
			const source = editor.document.getText();
			const { text, insertedLine } = insertConnectorEdge(
				source,
				edgeLine,
				nodeId,
			);
			const fullRange = new vscode.Range(
				editor.document.positionAt(0),
				editor.document.positionAt(source.length),
			);
			await editor.edit((eb) => eb.replace(fullRange, text));

			const newLineRange = editor.document.lineAt(insertedLine).range;
			editor.selection = new vscode.Selection(
				newLineRange.start,
				newLineRange.end,
			);
			editor.revealRange(newLineRange);
		}),
	);
}
