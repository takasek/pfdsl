// Controlled Monaco boundary; document-tab and formatting stay production code.
export const instances = [];
export const Uri = { parse: (value) => value };
export const MarkerSeverity = { Error: 8, Warning: 4, Info: 2 };
export const editor = {
	createModel(source) {
		const range = { fullDocument: true };
		return {
			source,
			getFullModelRange: () => range,
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
			edits: [],
			undoStops: 0,
			getValue: () => model.source,
			getModel: () => model,
			render() {},
			layout() {},
			addAction() {
				return { dispose() {} };
			},
			dispose() {
				this.disposed = true;
			},
			pushUndoStop() {
				this.undoStops++;
			},
			executeEdits(origin, edits) {
				this.edits.push({ origin, edits });
				assertFullDocument(edits, model);
				model.source = edits[0].text;
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
function assertFullDocument(edits, model) {
	if (edits.length !== 1 || edits[0].range !== model.getFullModelRange())
		throw new Error("Expected one full-model replacement");
}

// Language registration is outside this controlled editor seam.
export const languages = { register() {}, setLanguageConfiguration() {} };
