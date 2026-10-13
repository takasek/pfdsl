import {
	clampSelectionToBody,
	computeRangeFormatOutput,
	type FormatStyle,
} from "@pfdsl/editor";
import * as monaco from "monaco-editor/editor/editor.api.js";

/** Editor-owned actions; the toolbar's full-document formatter stays separate. */
export function registerSelectionFormatting(
	editor: monaco.editor.IStandaloneCodeEditor,
) {
	let disposed = false;
	function formatSelection(style: FormatStyle) {
		if (disposed) return;
		const selection = editor.getSelection();
		const model = editor.getModel();
		if (!selection || selection.isEmpty() || !model) return;
		const source = model.getValue();
		const clamped = clampSelectionToBody(
			source,
			selection.startLineNumber - 1,
			selection.endLineNumber - 1,
		);
		if (!clamped) return;
		const startLine = clamped.startLine + 1;
		const endLine = clamped.endLine + 1;
		// Match the extension: inclusive end line, including an end at column one.
		const range = new monaco.Range(
			startLine,
			1,
			endLine < model.getLineCount() ? endLine + 1 : endLine,
			endLine < model.getLineCount() ? 1 : model.getLineMaxColumn(endLine),
		);
		const output = computeRangeFormatOutput(
			model.getValueInRange(range),
			style,
		);
		if (output === null) return;
		editor.pushUndoStop();
		editor.executeEdits("pfdsl.formatSelection", [{ range, text: output }]);
		editor.pushUndoStop();
	}
	const actions = (["flows", "flat"] as const).map((style, order) =>
		editor.addAction({
			id: `pfdsl.formatSelection.${style}`,
			label: `Format selection (${style === "flows" ? "Flows" : "Flat"})`,
			precondition: "editorHasSelection",
			contextMenuGroupId: "1_modification",
			contextMenuOrder: 1 + order,
			run: () => formatSelection(style),
		}),
	);
	return {
		dispose() {
			disposed = true;
			for (const action of actions) action.dispose();
		},
	};
}
