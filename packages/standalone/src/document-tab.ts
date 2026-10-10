import {
	analyzeSnapshot,
	applyPreviewEdit,
	computeNormalizedEdgesOutput,
	type DocumentModel,
	type FormatStyle,
	findFrontmatterDefinitionRange,
	nodeIdAtSourcePosition,
	positionOfNodeId,
} from "@pfdsl/editor";
import { mountPreview } from "@pfdsl/editor/preview";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";
import "./language.js";
import { createNormalizedEdgesPanel } from "./normalized-edges.js";
import { formatSnapshot, processSnapshot } from "./processing.js";
import { registerSelectionFormatting } from "./selection-format.js";

interface DocumentTabOptions {
	parent: HTMLElement;
	key: string;
	name: string;
	source: string;
	path: string | null;
	read: (path: string) => Promise<string | null>;
	reportStatus: (message: string) => void;
	onChange?: () => void;
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
	onChange,
}: DocumentTabOptions) {
	let snapshot: DocumentModel | undefined;
	let revision = 0;
	let disposed = false;
	const container = document.createElement("div");
	container.className = "document";
	const editorElement = document.createElement("div");
	editorElement.className = "editor";
	const previewElement = document.createElement("div");
	previewElement.className = "preview";
	container.append(editorElement, previewElement);
	parent.append(container);
	const normalizedEdges = createNormalizedEdgesPanel(container);
	const model = monaco.editor.createModel(
		source,
		"pfdsl",
		monaco.Uri.parse(`inmemory://pfdsl/${encodeURIComponent(key)}`),
	);
	const editor = monaco.editor.create(editorElement, {
		model,
		automaticLayout: true,
		minimap: { enabled: false },
		fontSize: 14,
		renderWhitespace: "selection",
	});
	const selectionFormatting = registerSelectionFormatting(editor);
	let editorRenderQueued = false;
	function requestEditorRender() {
		if (disposed || editorRenderQueued) return;
		editorRenderQueued = true;
		// Reveal/scroll events can follow cursor events within the same operation.
		queueMicrotask(() => {
			editorRenderQueued = false;
			if (!disposed) editor.render();
		});
	}
	editor.onDidScrollChange(requestEditorRender);
	editor.onDidChangeCursorSelection(requestEditorRender);
	const button = document.createElement("button");
	button.textContent = name;
	button.setAttribute("role", "tab");
	const preview = mountPreview(previewElement, {
		canOpenRelatedFiles: false,
		postMessage(message) {
			if (disposed) return;
			if (
				message.type === "createDefinition" ||
				message.type === "addConnector"
			) {
				const result = applyPreviewEdit(editor.getValue(), message);
				if (!result.ok) {
					reportStatus(result.message);
					return;
				}
				const selections = result.selection
					? [
							new monaco.Selection(
								result.selection.start.line,
								result.selection.start.column,
								result.selection.end.line,
								result.selection.end.column,
							),
						]
					: undefined;
				editor.pushUndoStop();
				editor.executeEdits(
					"pfdsl.preview",
					[
						{
							range: monaco.Range.fromPositions(
								model.getPositionAt(result.edit.startOffset),
								model.getPositionAt(result.edit.endOffset),
							),
							text: result.edit.text,
						},
					],
					message.type === "createDefinition" ? selections : undefined,
				);
				editor.pushUndoStop();
				if (result.selection) {
					editor.revealRangeInCenter(selections![0]!);
					if (message.type === "createDefinition") editor.focus();
				}
				reportStatus(
					result.needsCriteria
						? "Edit the new label. Add criteria describing how this produced artifact is judged complete (W002)."
						: "Preview edit applied. Complete any required metadata.",
				);
			} else if (
				message.type === "nodeClick" &&
				snapshot &&
				snapshot.source === editor.getValue()
			) {
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
		if (disposed) return;
		const currentRevision = ++revision;
		const result = await processSnapshot(editor.getValue(), path, read);
		if (disposed || currentRevision !== revision) return;
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
		// Publish the editor's visible lines before replacing the matching graph.
		editor.render();
		await preview.receive(result.message);
	}

	function requestRefresh() {
		void refresh().catch((error) => reportStatus(String(error)));
	}
	editor.onDidChangeModelContent(() => {
		if (disposed) return;
		normalizedEdges.clear();
		button.textContent = `${name}${editor.getValue() === source ? "" : " •"}`;
		requestEditorRender();
		requestRefresh();
		onChange?.();
	});
	editor.onDidChangeCursorPosition((event) => {
		if (!snapshot || snapshot.source !== editor.getValue() || disposed) return;
		const nodeId = nodeIdAtSourcePosition(snapshot, snapshot.source, {
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
		dispose() {
			disposed = true;
			revision++;
			selectionFormatting.dispose();
			preview.dispose();
			editor.dispose();
			model.dispose();
			container.remove();
			button.remove();
		},
		activate() {
			editor.layout();
			requestRefresh();
		},
		getSource: () => editor.getValue(),
		getRevision: () => model.getVersionId(),
		setSource(value: string) {
			editor.pushUndoStop();
			const eol = value.includes("\r\n") ? "\r\n" : "\n";
			if (model.getEOL() !== eol) {
				// Keep EOL and text in separate undo entries: Monaco stores edit offsets in the old EOL.
				model.pushEOL(
					eol === "\r\n"
						? monaco.editor.EndOfLineSequence.CRLF
						: monaco.editor.EndOfLineSequence.LF,
				);
				editor.pushUndoStop();
			}
			editor.executeEdits("pfdsl.disk", [
				{ range: model.getFullModelRange(), text: value },
			]);
			editor.pushUndoStop();
		},
		setLocation(
			nextPath: string | null,
			nextName: string,
			readSource?: (path: string) => Promise<string | null>,
		) {
			path = nextPath;
			name = nextName;
			if (readSource) read = readSource;
			button.textContent = `${name}${editor.getValue() === source ? "" : " •"}`;
			requestRefresh();
		},
		markSaved(value: string) {
			source = value;
			button.textContent = `${name}${editor.getValue() === source ? "" : " •"}`;
		},
		isDirty: () => editor.getValue() !== source,
		normalize() {
			if (disposed) return;
			const output = computeNormalizedEdgesOutput(
				analyzeSnapshot(editor.getValue()),
			);
			normalizedEdges.show(output);
		},
		format(style: FormatStyle = "flows") {
			const output = formatSnapshot(editor.getValue(), style);
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
