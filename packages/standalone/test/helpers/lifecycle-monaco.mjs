// A controlled editor seam: document-tab and its preview remain production code.
export const instances = [];
export const markerCalls = [];
export const snapshotCalls = [];
export const Uri = { parse: (value) => value };
export const MarkerSeverity = { Error: 8, Warning: 4, Info: 2 };
export const editor = {
	createModel(source) {
		return {
			source,
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
			renders: 0,
			getValue: () => model.source,
			getModel: () => model,
			render() {
				this.renders++;
			},
			layout() {},
			dispose() {
				this.disposed = true;
			},
		};
		for (const event of [
			"onDidScrollChange",
			"onDidChangeCursorSelection",
			"onDidChangeModelContent",
			"onDidChangeCursorPosition",
		]) {
			instance[event] = (callback) => {
				callbacks[event] = callback;
				return { dispose() {} };
			};
		}
		instances.push(instance);
		return instance;
	},
	setModelMarkers(model, owner, markers) {
		markerCalls.push({ model, owner, markers });
	},
};
