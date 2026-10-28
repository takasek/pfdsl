/** A document view fake: state belongs to the returned tab, never to globals. */
export function createDocumentTab(
	options,
	{ normalize = (text) => text, hook = () => {} } = {},
) {
	let source = normalize(options.source),
		revision = 0;
	const document = options.parent.ownerDocument;
	const container = document.createElement("div"),
		button = document.createElement("button");
	button.setAttribute("role", "tab");
	button.setAttribute("aria-selected", "false");
	options.parent.append(container);
	button.textContent = options.name;
	const tab = {
		key: options.key,
		container,
		button,
		location: options.path,
		read: options.read,
		references: options.referenceServices,
		exportServices: options.exportServices,
		setSourceCalls: 0,
		activate() {},
		deactivate() {},
		focus() {},
		command() {},
		canDiagram() {
			return true;
		},
		canCreateDefinition() {
			return false;
		},
		report: options.reportStatus,
		getDiagnosticsSummary: () => "No problems",
		dispose() {
			container.remove();
			button.remove();
			hook("dispose", tab);
		},
		getSource: () => source,
		getRevision: () => revision,
		type(text) {
			source = text;
			revision++;
			hook("type", tab, text);
			options.onChange?.();
		},
		setSource(text) {
			this.setSourceCalls++;
			source = normalize(text);
			revision++;
			hook("setSource", tab, text);
			options.onChange?.();
		},
		setLocation(path, name, read) {
			this.location = path;
			this.read = read;
			button.textContent = name;
		},
		markSaved() {},
		format() {},
		normalize() {},
	};
	return tab;
}
