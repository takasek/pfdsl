import {
	type DocumentModel,
	findFrontmatterDefinitionRange,
	nodeIdAtCursor,
	positionOfNodeId,
	previewStyles,
} from "@pfdsl/editor";
import { mountPreview } from "@pfdsl/editor/preview";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as monaco from "monaco-editor/editor/editor.api.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { verifyNativeCorpus } from "./acceptance.js";
import { createCloseGuard } from "./close-guard.js";
import { formatSnapshot, processSnapshot } from "./processing.js";
import "./style.css";

// The worker is bundled locally. No network service or language sidecar is used.
(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
	getWorker: () => new EditorWorker(),
};
const style = document.createElement("style");
style.textContent = previewStyles;
document.head.append(style);
const status = document.querySelector<HTMLElement>("#status")!;
const tabs = document.querySelector<HTMLElement>("#tabs")!;
const documents = document.querySelector<HTMLElement>("#documents")!;
interface Tab {
	path: string | null;
	container: HTMLElement;
	button: HTMLButtonElement;
	editor: monaco.editor.IStandaloneCodeEditor;
	preview: ReturnType<typeof mountPreview>;
	model?: DocumentModel;
	revision: number;
	initial: string;
}
const opened = new Map<string, Tab>();
let active: Tab | undefined;
const native = "__TAURI_INTERNALS__" in window;
const read = async (path: string): Promise<string | null> => {
	try {
		return await invoke<string>("read_document", { path });
	} catch {
		return null;
	}
};
function activate(tab: Tab) {
	active = tab;
	for (const other of opened.values()) {
		other.container.style.display = other === tab ? "flex" : "none";
		other.button.setAttribute("aria-selected", String(other === tab));
	}
	tab.editor.layout();
	void refresh(tab);
}
async function refresh(tab: Tab) {
	const revision = ++tab.revision;
	const result = await processSnapshot(tab.editor.getValue(), tab.path, read);
	if (revision !== tab.revision) return;
	tab.model = result.model;
	monaco.editor.setModelMarkers(
		tab.editor.getModel()!,
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
	await tab.preview.receive(result.message);
}
function openDocument(
	key: string,
	name: string,
	source: string,
	path: string | null,
) {
	const existing = opened.get(key);
	if (existing) {
		activate(existing);
		return;
	}
	const container = document.createElement("div");
	container.className = "document";
	const editorElement = document.createElement("div");
	editorElement.className = "editor";
	const previewElement = document.createElement("div");
	previewElement.className = "preview";
	container.append(editorElement, previewElement);
	documents.append(container);
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
	tabs.append(button);
	const preview = mountPreview(previewElement, {
		postMessage(message) {
			if (message.type === "nodeClick" && tab.model) {
				const definition = findFrontmatterDefinitionRange(
					tab.model,
					message.nodeId,
				);
				const body = positionOfNodeId(
					tab.model.document.statements,
					message.nodeId,
				);
				const position =
					definition?.start ??
					(body ? { line: body.line + 1, column: body.column + 1 } : undefined);
				if (position) {
					editor.setPosition({
						lineNumber: position.line,
						column: position.column,
					});
					editor.revealPositionInCenter({
						lineNumber: position.line,
						column: position.column,
					});
					editor.focus();
				}
			} else if (message.type !== "ready")
				status.textContent =
					"Related-file navigation is not available in this build.";
		},
	});
	const tab: Tab = {
		path,
		container,
		button,
		editor,
		preview,
		revision: 0,
		initial: source,
	};
	opened.set(key, tab);
	button.onclick = () => activate(tab);
	editor.onDidChangeModelContent(() => {
		button.textContent = `${name}${editor.getValue() === tab.initial ? "" : " •"}`;
		void refresh(tab).catch((error) => {
			status.textContent = String(error);
		});
	});
	editor.onDidChangeCursorPosition((event) => {
		if (!tab.model) return;
		const nodeId = nodeIdAtCursor(tab.model, {
			line: event.position.lineNumber - 1,
			character: event.position.column - 1,
		});
		void preview.receive(
			nodeId ? { type: "focus", nodeId } : { type: "clearFocus" },
		);
	});
	activate(tab);
}
document.querySelector<HTMLButtonElement>("#format")!.onclick = () => {
	if (!active) return;
	const output = formatSnapshot(active.editor.getValue());
	if (output === null) return;
	active.editor.pushUndoStop();
	active.editor.executeEdits("pfdsl.format", [
		{ range: active.editor.getModel()!.getFullModelRange(), text: output },
	]);
	active.editor.pushUndoStop();
};
document.querySelector<HTMLButtonElement>("#open")!.onclick = async () => {
	if (!native) {
		status.textContent = "Open the desktop application to choose a folder.";
		return;
	}
	try {
		const root = await invoke<string | null>("select_folder");
		if (!root) return;
		const paths = await invoke<string[]>("list_documents");
		const files = document.querySelector<HTMLElement>("#files")!;
		files.replaceChildren();
		for (const path of paths) {
			const button = document.createElement("button");
			button.textContent = path.slice(root.length + 1);
			button.title = path;
			button.onclick = async () => {
				const source = await read(path);
				if (source !== null)
					openDocument(path, path.split("/").pop()!, source, path);
			};
			files.append(button);
		}
		status.textContent = "Changes stay in this window; files are not saved.";
	} catch (error) {
		status.textContent = String(error);
	}
};
openDocument(
	"welcome",
	"Welcome",
	"---\ntitle: Welcome to PFDSL\n---\nidea >> design -> plan\n",
	null,
);
openDocument(
	"japanese",
	"日本語",
	"---\ntitle: 日本語のフロー\nartifact:\n  input:\n    label: 入力\n  output:\n    label: 成果物\nprocess:\n  build:\n    label: 作成する\n---\ninput >> build -> output\n",
	null,
);
if (native) {
	void verifyNativeCorpus()
		.then((entry) => {
			if (entry) openDocument(entry.path, entry.file, entry.source, entry.path);
		})
		.catch((error) => {
			status.textContent = `Verification failed: ${String(error)}`;
		});
	const guardClose = createCloseGuard(() => invoke("confirm_discard"));
	void getCurrentWindow().onCloseRequested((event) => {
		void guardClose(
			event,
			[...opened.values()].some((tab) => tab.editor.getValue() !== tab.initial),
		).catch((error) => {
			status.textContent = String(error);
		});
	});
}
