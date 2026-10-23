import {
	analyzeSnapshot,
	applyPreviewEdit,
	computeNormalizedEdgesOutput,
	type DocumentModel,
	type FormatStyle,
	findFrontmatterDefinitionRange,
	nodeIdAtSourcePosition,
	positionOfNodeId,
	repairResultMessage,
} from "@pfdsl/editor";
import { mountPreview } from "@pfdsl/editor/preview";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";
import "./language.js";
import { registerExportFeatures } from "./export-features.js";
import {
	createExportResults,
	type ExportResultPresenter,
} from "./export-results.js";
import type { ExportServices } from "./export-services.js";
import { registerLanguageFeatures } from "./language-features.js";
import { createNormalizedEdgesPanel } from "./normalized-edges.js";
import { formatSnapshot, processSnapshot } from "./processing.js";
import { registerReferenceFeatures } from "./reference-features.js";
import type { ReferenceServices } from "./reference-services.js";
import { registerSelectionFormatting } from "./selection-format.js";
import { createWorkspaceSplit } from "./workspace-split.js";

interface DocumentTabOptions {
	parent: HTMLElement;
	key: string;
	name: string;
	source: string;
	path: string | null;
	read: (path: string) => Promise<string | null>;
	reportStatus: (message: string, channel?: string) => void;
	onChange?: () => void;
	referenceServices?: ReferenceServices | undefined;
	exportServices?: ExportServices | undefined;
	showExportResults?: ExportResultPresenter | undefined;
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
	referenceServices,
	exportServices,
	showExportResults,
}: DocumentTabOptions) {
	let snapshot: DocumentModel | undefined;
	let revision = 0;
	let disposed = false;
	let diagnosticsSummary = "Checking…";
	const container = document.createElement("div");
	container.className = "document";
	const editorElement = document.createElement("div");
	editorElement.className = "editor";
	const previewElement = document.createElement("div");
	previewElement.className = "preview";
	const previewColumn = document.createElement("div");
	previewColumn.className = "preview-column";
	previewColumn.append(previewElement);
	container.append(editorElement, previewColumn);
	parent.append(container);
	const normalizedEdges = createNormalizedEdgesPanel(previewColumn);
	const dependencyProblems = document.createElement("section");
	dependencyProblems.className = "dependency-problems";
	dependencyProblems.setAttribute("aria-label", "Dependency problems");
	dependencyProblems.hidden = true;
	previewColumn.append(dependencyProblems);
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
	let references: ReturnType<typeof registerReferenceFeatures>;
	const languageFeatures = registerLanguageFeatures(
		editor,
		reportStatus,
		referenceServices
			? {
					open: (reference) => references.open(reference),
					run: (command) => references.run(command),
				}
			: undefined,
	);
	const exports = registerExportFeatures(
		editor,
		() => ({ name, path, read }),
		exportServices,
		reportStatus,
		showExportResults ?? createExportResults(parent, reportStatus),
	);
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
	button.setAttribute("aria-selected", "false");
	const preview = mountPreview(previewElement, {
		canOpenRelatedFiles: !!referenceServices,
		onStateChange: () => onChange?.(),
		postMessage(message) {
			if (disposed) return;
			if (
				message.type === "createDefinition" ||
				message.type === "addConnector" ||
				message.type === "deleteConnector" ||
				message.type === "toggleFeedback"
			) {
				const beforeSource = editor.getValue();
				const result = applyPreviewEdit(beforeSource, message);
				if (!result.ok) {
					reportStatus(result.message);
					void preview.receive({
						type: "editResult",
						request: message,
						ok: false,
						message: result.message,
					});
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
				void preview.receive({
					type: "editResult",
					request: message,
					ok: true,
				});
				if (result.selection) {
					editor.revealRangeInCenter(selections![0]!);
					if (message.type === "createDefinition") editor.focus();
				}
				reportStatus(
					message.repair && message.type === "deleteConnector"
						? repairResultMessage(message, beforeSource, result.source)
						: result.needsCriteria
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
					if (!message.preserveFocus) editor.focus();
				}
			} else if (
				message.type === "openFile" ||
				message.type === "openLocation" ||
				message.type === "openUrl"
			) {
				if (!snapshot || snapshot.source !== editor.getValue()) {
					reportStatus(
						"The document changed. Wait for the preview to refresh before opening its reference.",
					);
					return;
				}
				void references
					.handleMessage(message)
					.catch((error) => reportStatus(String(error)));
			} else if (message.type !== "ready")
				reportStatus("Related-file navigation is not available in this build.");
		},
	});
	const split = createWorkspaceSplit(container, () => editor.layout());
	editorElement.after(split.divider);
	references = registerReferenceFeatures(
		editor,
		container,
		referenceServices,
		(message) => {
			void preview.receive(message);
		},
		reportStatus,
		previewColumn,
	);

	async function refresh() {
		if (disposed) return;
		const currentRevision = ++revision;
		diagnosticsSummary = "Checking…";
		onChange?.();
		let result: Awaited<ReturnType<typeof processSnapshot>>;
		try {
			result = await processSnapshot(editor.getValue(), path, read);
		} catch (error) {
			if (!disposed && currentRevision === revision) {
				diagnosticsSummary = `Analysis failed: ${String(error)}`;
				onChange?.();
			}
			return;
		}
		if (disposed || currentRevision !== revision) return;
		snapshot = result.model;
		const dependencyDiagnostics = result.presetDiagnostics.map((d) => ({
			...d,
			message: `Dependency ${d.file ?? path}: ${d.message}${d.file ? ` (${d.range.start.line}:${d.range.start.column})` : ""}`,
			// Foreign coordinates belong to the dependency, not this editor model.
			range: d.file
				? { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }
				: d.range,
		}));
		const allDiagnostics = [
			...result.model.diagnostics,
			...dependencyDiagnostics,
		];
		diagnosticsSummary = allDiagnostics.length
			? `${allDiagnostics.filter((d) => d.severity === "error").length} errors, ${allDiagnostics.filter((d) => d.severity === "warning").length} warnings, ${allDiagnostics.filter((d) => d.severity !== "error" && d.severity !== "warning").length} hints`
			: "No problems";
		dependencyProblems.replaceChildren();
		dependencyProblems.hidden = dependencyDiagnostics.length === 0;
		for (const d of dependencyDiagnostics) {
			const item = document.createElement("div");
			item.textContent = `${d.code}: ${d.message}`;
			dependencyProblems.append(item);
		}
		monaco.editor.setModelMarkers(
			editor.getModel()!,
			"pfdsl",
			[...result.model.diagnostics, ...dependencyDiagnostics].map((d) => ({
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
		try {
			await preview.receive(result.message);
		} catch (error) {
			if (!disposed && currentRevision === revision)
				reportStatus(`Preview failed: ${String(error)}`);
		}
		if (!disposed && currentRevision === revision) references.refresh();
		onChange?.();
	}

	function requestRefresh() {
		const pending = refresh();
		const requested = revision;
		void pending.catch((error) => {
			if (!disposed && requested === revision) {
				diagnosticsSummary = `Analysis failed: ${String(error)}`;
				onChange?.();
			}
		});
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
		if (event.source === "pfdsl.preview") return;
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
			split.dispose();
			languageFeatures.dispose();
			references.dispose();
			exports.dispose();
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
		focus() {
			editor.focus();
		},
		canDiagram() {
			return !previewElement.querySelector<HTMLButtonElement>(
				"#node-actions-toggle",
			)!.disabled;
		},
		canCreateDefinition: () => preview.canCreateDefinition(),
		command(id: string) {
			if (id === "create-definition") {
				preview.createDefinition();
				return;
			}
			const diagram = [
				"fit-graph",
				"actual-size",
				"zoom-in",
				"zoom-out",
				"node-actions-toggle",
				"preview-help-toggle",
			];
			if (diagram.includes(id)) {
				previewElement.querySelector<HTMLButtonElement>(`#${id}`)?.click();
				return;
			}
			if (id === "font-increase" || id === "font-decrease") {
				const size = editor.getOption(monaco.editor.EditorOption.fontSize);
				editor.updateOptions({
					fontSize: Math.max(
						8,
						Math.min(48, size + (id === "font-increase" ? 1 : -1)),
					),
				});
				return;
			}
			editor.focus();
			editor.trigger("pfdsl.menu", id === "delete" ? "deleteRight" : id, null);
		},
		deactivate() {
			references.cancelPending();
			exports.cancelPending();
		},
		getSource: () => editor.getValue(),
		getRevision: () => model.getVersionId(),
		getDiagnosticsSummary: () => diagnosticsSummary,
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
			references.locationChanged();
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
		hasUnsavedText: () => editor.getValue() !== source,
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
