import { createDocumentTab as create } from "../../src/document-tab.js";
import { instances } from "./lifecycle-monaco.mjs";
export function createDocumentTab(options) {
	const tab = create(options),
		editor = instances.at(-1);
	tab.type = (source) => {
		editor.model.source = source;
		editor.model.version++;
		editor.callbacks.onDidChangeModelContent();
	};
	return tab;
}
