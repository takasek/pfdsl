import { previewStyles } from "@pfdsl/editor";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { verifyNativeCorpus } from "./acceptance.js";
import { mountApplication } from "./application.js";
import { createDocumentTab } from "./document-tab.js";
import { installNativeMenu } from "./native-menu.js";
import { createTextComparison } from "./text-comparison.js";
import "./style.css";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
	getWorker: () => new EditorWorker(),
};
const style = document.createElement("style");
style.textContent = previewStyles;
document.head.append(style);
const application = mountApplication({
	document,
	createDocumentTab,
	createTextComparison,
	...("__TAURI_INTERNALS__" in window
		? {
				native: {
					invoke,
					listen: (event, callback) => listen<string>(event, callback),
					installMenu: installNativeMenu,
					verifyCorpus: (signal) =>
						verifyNativeCorpus({ document, invoke, signal }),
					setTitle: (title) => getCurrentWindow().setTitle(title),
					closeWindow: () => getCurrentWindow().close(),
				},
			}
		: {}),
});
window.addEventListener("pagehide", () => application.dispose(), {
	once: true,
});
