import { previewStyles } from "@pfdsl/editor";
import * as monaco from "monaco-editor/editor/editor.api.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { mountApplication } from "../../src/application.ts";
import { createDocumentTab } from "../../src/document-tab.ts";
import { createTextComparison } from "../../src/text-comparison.ts";
import "../../src/style.css";

// Real views and browser events, with explicit native receipts at the host boundary.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const style = document.createElement("style");
style.textContent = previewStyles;
document.head.append(style);
const views = [],
	receipts = new Map();
let selected;
const application = mountApplication({
	document,
	createDocumentTab(options) {
		const view = createDocumentTab(options);
		views.push(view);
		return view;
	},
	createTextComparison,
	scheduler: { setInterval: () => 0, clearInterval() {} },
	native: {
		async invoke(command, args) {
			switch (command) {
				case "document_capabilities":
					return { save: true, reason: null };
				case "select_document":
					return selected;
				case "inspect_document":
					return receipts.get(args.id);
				case "list_recent":
					return [];
				case "read_dependency":
					return null;
				case "confirm_close_document":
					return "discard";
				case "remember_document":
				case "release_document":
				case "exit_listener_ready":
					return;
				default:
					throw new Error(`Unexpected native operation: ${command}`);
			}
		},
		listen: async () => () => {},
		installMenu: async () => ({ update() {}, recent() {}, dispose() {} }),
		verifyCorpus: async () => null,
		setTitle: async () => {},
		closeWindow: async () => {},
	},
});
const workspace = {
	async open(receipt) {
		selected = receipt;
		receipts.set(selected.id, selected);
		await application.command("open-file");
	},
	new: () => application.command("new"),
	tabs: () => views.filter((view) => view.button.isConnected),
	active: () =>
		views.find(
			(view) =>
				view.button.isConnected &&
				view.button.getAttribute("aria-selected") === "true",
		),
	editors: () => monaco.editor.getEditors(),
};
window.usabilityWorkspace = workspace;
window.navigationWorkspace = workspace;
window.addEventListener("pagehide", () => application.dispose(), {
	once: true,
});
