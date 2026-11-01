// A controlled editor seam: document-tab and its preview remain production code.
export const instances = [];
export const language = {};
export const markerCalls = [];
export const snapshotCalls = [];
export const linkOpeners = [];
export const Uri = { parse: (value) => value };
export const MarkerSeverity = { Error: 8, Warning: 4, Info: 2 };
export const KeyMod = { CtrlCmd: 2048, WinCtrl: 256 };
export const KeyCode = { KeyG: 37, KeyL: 42 };
export const editor = {
	addKeybindingRules() {},
	registerLinkOpener(opener) {
		linkOpeners.push(opener);
		return { dispose() {} };
	},
	createModel(source) {
		return {
			source,
			version: 1,
			getVersionId() {
				return this.version;
			},
			getValue() {
				return this.source;
			},
			dispose() {
				this.disposed = true;
			},
		};
	},
	create(_element, { model }) {
		const callbacks = {};
		const instance = {
			actions: new Map(),
			getId: () => `lifecycle-${instances.indexOf(instance)}`,
			model,
			callbacks,
			renders: 0,
			triggerCalls: [],
			focus() {},
			getValue: () => model.source,
			getModel: () => model,
			setPosition(position) {
				this.position = position;
			},
			trigger(source, command, payload) {
				this.triggerCalls.push({ source, command, payload });
			},
			render() {
				this.renders++;
			},
			layout() {},
			addAction(action) {
				this.actions.set(action.id, action);
				return { dispose() {} };
			},
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

// Language registration is outside this controlled editor seam.
export const languages = new Proxy(
	{
		register() {},
		setLanguageConfiguration() {},
		setMonarchTokensProvider() {},
	},
	{
		get(target, key) {
			return target[key] ?? (() => ({ dispose() {} }));
		},
	},
);
