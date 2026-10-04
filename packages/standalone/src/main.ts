import { previewStyles } from "@pfdsl/editor";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { verifyNativeCorpus } from "./acceptance.js";
import { createCloseGuard } from "./close-guard.js";
import { createDocumentTab, type DocumentTab } from "./document-tab.js";
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
const opened = new Map<string, DocumentTab>();
let active: DocumentTab | undefined;
const native = "__TAURI_INTERNALS__" in window;
const read = async (path: string): Promise<string | null> => {
	try {
		return await invoke<string>("read_document", { path });
	} catch {
		return null;
	}
};
function activate(tab: DocumentTab) {
	active = tab;
	for (const other of opened.values()) {
		other.container.style.display = other === tab ? "flex" : "none";
		other.button.setAttribute("aria-selected", String(other === tab));
	}
	tab.activate();
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
	const tab = createDocumentTab({
		parent: documents,
		key,
		name,
		source,
		path,
		read,
		reportStatus: (message) => {
			status.textContent = message;
		},
	});
	tabs.append(tab.button);
	opened.set(key, tab);
	tab.button.onclick = () => activate(tab);
	activate(tab);
}
document.querySelector<HTMLButtonElement>("#format")!.onclick = () =>
	active?.format();
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
			[...opened.values()].some((tab) => tab.isDirty()),
		).catch((error) => {
			status.textContent = String(error);
		});
	});
}
