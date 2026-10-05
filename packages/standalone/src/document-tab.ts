import {
	type DocumentModel,
	findFrontmatterDefinitionRange,
	nodeIdAtCursor,
	positionOfNodeId,
} from "@pfdsl/editor";
import { mountPreview } from "@pfdsl/editor/preview";
import * as monaco from "monaco-editor/editor/editor.api.js";
import { formatSnapshot, processSnapshot } from "./processing.js";

interface DocumentTabOptions {
	parent: HTMLElement;
	key: string;
	name: string;
	source: string;
	path: string | null;
	read: (path: string) => Promise<string | null>;
	reportStatus: (message: string) => void;
}

/** One Monaco editor and preview pair, with private snapshot and refresh state. */
export function createDocumentTab({
	parent,
	key,
	name,
	source,
	path,
	read,
	reportStatus,
}: DocumentTabOptions) {
	let snapshot: DocumentModel | undefined;
	let revision = 0;
	const container = document.createElement("div");
	container.className = "document";
	const editorElement = document.createElement("div");
	editorElement.className = "editor";
	const previewElement = document.createElement("div");
	previewElement.className = "preview";
	container.append(editorElement, previewElement);
	parent.append(container);
	const model = monaco.editor.createModel(
		source,
		"plaintext",
		monaco.Uri.parse(`inmemory://pfdsl/${encodeURIComponent(key)}`),
	);
	const editor = monaco.editor.create(editorElement, {
		model,
		automaticLayout: true,
		minimap: { enabled: false },
		fontSize: 14,
		renderWhitespace: "selection",
	});
	const button = document.createElement("button");
	button.textContent = name;
	button.setAttribute("role", "tab");
	const preview = mountPreview(previewElement, {
		canOpenRelatedFiles: false,
		postMessage(message) {
			if (message.type === "nodeClick" && snapshot) {
				const definition = findFrontmatterDefinitionRange(
					snapshot,
					message.nodeId,
				);
				const body = positionOfNodeId(
					snapshot.document.statements,
					message.nodeId,
				);
				const position =
					definition?.start ??
					(body ? { line: body.line + 1, column: body.column + 1 } : undefined);
				if (position) {
					const editorPosition = {
						lineNumber: position.line,
						column: position.column,
					};
					editor.setPosition(editorPosition);
					editor.revealPositionInCenter(editorPosition);
					editor.focus();
				}
			} else if (message.type !== "ready")
				reportStatus("Related-file navigation is not available in this build.");
		},
	});

	async function refresh() {
		const currentRevision = ++revision;
		const result = await processSnapshot(editor.getValue(), path, read);
		if (currentRevision !== revision) return;
		snapshot = result.model;
		monaco.editor.setModelMarkers(
			editor.getModel()!,
			"pfdsl",
			result.model.diagnostics.map((d) => ({
				severity:
					d.severity === "error"
						? monaco.MarkerSeverity.Error
						: d.severity === "warning"
							? monaco.MarkerSeverity.Warning
							: monaco.MarkerSeverity.Info,
				message: d.message,
				code: d.code,
				startLineNumber: d.range.start.line,
				startColumn: d.range.start.column,
				endLineNumber: d.range.end.line,
				endColumn: d.range.end.column,
			})),
		);
		await preview.receive(result.message);
	}

	function requestRefresh() {
		void refresh().catch((error) => reportStatus(String(error)));
	}
	editor.onDidChangeModelContent(() => {
		button.textContent = `${name}${editor.getValue() === source ? "" : " •"}`;
		requestRefresh();
	});
	editor.onDidChangeCursorPosition((event) => {
		if (!snapshot) return;
		const nodeId = nodeIdAtCursor(snapshot, {
			line: event.position.lineNumber - 1,
			character: event.position.column - 1,
		});
		void preview.receive(
			nodeId ? { type: "focus", nodeId } : { type: "clearFocus" },
		);
	});
	return {
		container,
		button,
		activate() {
			editor.layout();
			requestRefresh();
		},
		isDirty: () => editor.getValue() !== source,
		format() {
			const output = formatSnapshot(editor.getValue());
			if (output === null) return;
			editor.pushUndoStop();
			editor.executeEdits("pfdsl.format", [
				{ range: editor.getModel()!.getFullModelRange(), text: output },
			]);
			editor.pushUndoStop();
		},
	};
}
export type DocumentTab = ReturnType<typeof createDocumentTab>;
