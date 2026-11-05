import {
	buildConnectorEdgeLine,
	type ConnectorKind,
	type ConnectorRole,
	compatibleOtherKind,
	connectorChoiceLabel,
	edgeAlreadyExists,
	insertConnectorEdge,
	nodeIdAtSourcePosition,
	outputProducerConflict,
	validateNewNodeId,
} from "@pfdsl/editor";
import * as vscode from "vscode";
import { analyzeDocument, LANGUAGE_ID } from "./analyze.js";

/** Labels show the resulting edge syntax directly, adapted to the current node's role. */
function connectorItemsFor(
	nodeId: string,
	nodeRole: ConnectorRole,
): { connector: ConnectorKind; label: string; description: string }[] {
	if (nodeRole === "artifact") {
		return [
			{
				connector: ">>",
				label: connectorChoiceLabel(nodeId, nodeRole, ">>"),
				description: "Add as normal input to a process",
			},
			{
				connector: ">>?",
				label: connectorChoiceLabel(nodeId, nodeRole, ">>?"),
				description: "Add as feedback input to a process",
			},
			{
				connector: "->",
				label: connectorChoiceLabel(nodeId, nodeRole, "->"),
				description: "Add as the output of a process",
			},
		];
	}
	return [
		{
			connector: ">>",
			label: connectorChoiceLabel(nodeId, nodeRole, ">>"),
			description: "Add a normal input",
		},
		{
			connector: ">>?",
			label: connectorChoiceLabel(nodeId, nodeRole, ">>?"),
			description: "Add a feedback input",
		},
		{
			connector: "->",
			label: connectorChoiceLabel(nodeId, nodeRole, "->"),
			description: "Add an output",
		},
	];
}

function nodeIdAtCursor(
	editor: vscode.TextEditor,
): { nodeId: string; line: number } | undefined {
	const { document: doc, selection } = editor;
	const nodeId = nodeIdAtSourcePosition(
		analyzeDocument(doc),
		doc.getText(),
		selection.active,
	);
	return nodeId === undefined
		? undefined
		: { nodeId, line: selection.active.line };
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
			const { nodeId, line: cursorLine } = cursor;
			const candidateSource = editor.document.getText();
			const candidateVersion = editor.document.version;
			const isCurrent = () =>
				!editor.document.isClosed &&
				editor.document.version === candidateVersion &&
				editor.document.getText() === candidateSource;

			const { nodeKinds, edges } = analyzeDocument(editor.document);
			const nodeKind = nodeKinds.get(nodeId);
			if (nodeKind === "group") {
				vscode.window.showInformationMessage(
					"Cannot add a connector to a group node.",
				);
				return;
			}

			let nodeRole: ConnectorRole;
			if (nodeKind === "artifact" || nodeKind === "process") {
				nodeRole = nodeKind;
			} else {
				// Not yet declared or used anywhere — ask rather than silently
				// assuming a role, since every offered connector shape depends on it.
				const rolePick = await vscode.window.showQuickPick(
					[
						{ label: "Artifact", role: "artifact" as const },
						{ label: "Process", role: "process" as const },
					],
					{
						placeHolder: `"${nodeId}" isn't declared yet — is it an artifact or a process?`,
					},
				);
				if (!rolePick) return;
				nodeRole = rolePick.role;
			}

			const connectorPick = await vscode.window.showQuickPick(
				connectorItemsFor(nodeId, nodeRole),
				{ placeHolder: `Choose the connector for "${nodeId}"` },
			);
			if (!connectorPick) return;
			const connector = connectorPick.connector;

			const wantedKind = compatibleOtherKind(nodeRole);
			const newIdItem = `$(add) New ${wantedKind} ID…`;
			const existingIds = [...nodeKinds.entries()]
				.filter(([id, kind]) => id !== nodeId && kind === wantedKind)
				.map(([id]) => id)
				.sort();
			const items = [
				{ label: newIdItem, alwaysShow: true },
				...existingIds.map((id) => ({
					label: id,
					alwaysShow: false,
					description:
						outputProducerConflict(edges, nodeId, nodeRole, connector, id) ??
						"",
				})),
			];
			let idPick: (typeof items)[number] | undefined;
			while (true) {
				idPick = await vscode.window.showQuickPick(items, {
					placeHolder: `Select the ${wantedKind} to connect`,
				});
				if (!idPick) return;
				if (!isCurrent()) {
					vscode.window.showInformationMessage(
						"The document changed. Run Add Connector again.",
					);
					return;
				}
				const conflict = outputProducerConflict(
					edges,
					nodeId,
					nodeRole,
					connector,
					idPick.label,
				);
				if (idPick.label === newIdItem || !conflict) break;
				vscode.window.showInformationMessage(conflict);
			}
			if (!idPick) return;

			let otherId = idPick.label;
			if (idPick.label === newIdItem) {
				const input = await vscode.window.showInputBox({
					prompt: `New ${wantedKind} ID`,
					validateInput: (value) => {
						if (!isCurrent())
							return "The document changed. Run Add Connector again.";
						return (
							validateNewNodeId({
								value,
								currentNodeId: nodeId,
								wantedKind,
								kindOfExisting: (id) => nodeKinds.get(id),
							}) ??
							outputProducerConflict(edges, nodeId, nodeRole, connector, value)
						);
					},
				});
				if (!input) return;
				otherId = input;
			}
			if (!isCurrent()) {
				vscode.window.showInformationMessage(
					"The document changed. Run Add Connector again.",
				);
				return;
			}
			const current = analyzeDocument(editor.document);
			const invalid =
				validateNewNodeId({
					value: otherId,
					currentNodeId: nodeId,
					wantedKind,
					kindOfExisting: (id) => current.nodeKinds.get(id),
				}) ??
				outputProducerConflict(
					current.edges,
					nodeId,
					nodeRole,
					connector,
					otherId,
				);
			if (invalid) {
				vscode.window.showInformationMessage(invalid);
				return;
			}

			if (edgeAlreadyExists(edges, nodeId, nodeRole, connector, otherId)) {
				const choice = await vscode.window.showWarningMessage(
					`Connection ${buildConnectorEdgeLine(nodeId, nodeRole, connector, otherId)} already exists.`,
					{ modal: true },
					"Add anyway",
				);
				if (choice !== "Add anyway") return;
			}
			if (!isCurrent()) {
				vscode.window.showInformationMessage(
					"The document changed. Run Add Connector again.",
				);
				return;
			}

			const edgeLine = buildConnectorEdgeLine(
				nodeId,
				nodeRole,
				connector,
				otherId,
			);
			const source = editor.document.getText();
			const { text, insertedLine, anchored } = insertConnectorEdge(
				source,
				edgeLine,
				nodeId,
				cursorLine,
			);
			if (anchored) {
				// Single-line insert: less disruptive to fold state/undo than a
				// full-document replace, and valid because anchored insertion never
				// touches any other line's content. Insert relative to the *end*
				// of the preceding line (always a valid position) rather than the
				// start of insertedLine, which doesn't exist yet — and, when the
				// anchor is the document's last line with no trailing newline,
				// would silently clamp and merge into it.
				const anchorLineEnd = editor.document.lineAt(insertedLine - 1).range
					.end;
				await editor.edit((eb) => eb.insert(anchorLineEnd, `\n${edgeLine}`));
			} else {
				const fullRange = new vscode.Range(
					editor.document.positionAt(0),
					editor.document.positionAt(source.length),
				);
				await editor.edit((eb) => eb.replace(fullRange, text));
			}

			const lineEnd = editor.document.lineAt(insertedLine).range.end;
			editor.selection = new vscode.Selection(lineEnd, lineEnd);
			editor.revealRange(editor.document.lineAt(insertedLine).range);
		}),
	);
}
