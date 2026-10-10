import { Range } from "monaco-editor/editor/common/core/range.js";
// Controlled Monaco selection/edit boundary; formatter and host stay production code.
export const instances = [];
export const Uri = { parse: (value) => value };
export const MarkerSeverity = { Error: 8, Warning: 4, Info: 2 };
function offset(model, line, column) {
	const lines = model.source.split("\n");
	return (
		lines.slice(0, line - 1).reduce((n, s) => n + s.length + 1, 0) + column - 1
	);
}

export { Range };
export const editor = {
	createModel(source) {
		return {
			source,
			getValue() {
				return this.source;
			},
			getLineCount() {
				return this.source.split("\n").length;
			},
			getLineMaxColumn(line) {
				return this.source.split("\n")[line - 1].replace(/\r$/, "").length + 1;
			},
			getValueInRange(range) {
				return this.source.slice(
					offset(this, range.startLineNumber, range.startColumn),
					offset(this, range.endLineNumber, range.endColumn),
				);
			},
			getFullModelRange() {
				const last = this.getLineCount();
				return new Range(1, 1, last, this.getLineMaxColumn(last));
			},
			dispose() {
				this.disposed = true;
			},
		};
	},
	create(_element, { model }) {
		const callbacks = {};
		const instance = {
			model,
			callbacks,
			actions: [],
			edits: [],
			undoStops: 0,
			selection: null,
			getSelection() {
				return this.selection;
			},
			getValue: () => model.source,
			getModel: () => model,
			render() {},
			layout() {},
			dispose() {
				this.disposed = true;
			},
			addAction(action) {
				this.actions.push(action);
				return {
					dispose: () => {
						action.disposed = true;
					},
				};
			},
			pushUndoStop() {
				this.undoStops++;
			},
			executeEdits(origin, edits) {
				this.edits.push({ origin, edits });
				if (edits.length !== 1) throw Error("Expected one edit");
				const { range, text } = edits[0];
				const start = offset(model, range.startLineNumber, range.startColumn);
				const end = offset(model, range.endLineNumber, range.endColumn);
				model.source =
					model.source.slice(0, start) + text + model.source.slice(end);
				callbacks.onDidChangeModelContent?.();
			},
		};
		for (const event of [
			"onDidScrollChange",
			"onDidChangeCursorSelection",
			"onDidChangeModelContent",
			"onDidChangeCursorPosition",
		])
			instance[event] = (callback) => {
				callbacks[event] = callback;
				return { dispose() {} };
			};
		instances.push(instance);
		return instance;
	},
	setModelMarkers() {},
};
