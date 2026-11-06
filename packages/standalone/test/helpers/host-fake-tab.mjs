/** A document view fake: state belongs to the returned tab, never to globals. */
export function createDocumentTab(
	options,
	{
		normalize = (text) => text,
		hook = () => {},
		diagram = true,
		diagramView = true,
	} = {},
) {
	let source = normalize(options.source),
		revision = 0,
		diagnosticsCurrent = true,
		problemCount = source.match(/\bproblem\b/g)?.length ?? 0,
		diagnosticsSummary = summarize(problemCount);
	function summarize(count) {
		return count
			? `0 errors, ${count} warning${count === 1 ? "" : "s"}, 0 informational messages`
			: "No problems";
	}
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
		exportResults: options.showExportResults,
		setSourceCalls: 0,
		activate() {},
		deactivate() {},
		focus() {},
		command() {},
		canDiagram() {
			return diagram;
		},
		canViewDiagram() {
			return diagramView;
		},
		canCreateDefinition() {
			return false;
		},
		report: options.reportStatus,
		// Each `problem` word in the source stands for one warning. A refresh
		// retains the last completed result until finishRefresh publishes another.
		getProblemCount: () => problemCount,
		getDiagnosticsSummary: () => diagnosticsSummary,
		areDiagnosticsCurrent: () => diagnosticsCurrent,
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
			diagnosticsCurrent = false;
			hook("type", tab, text);
			options.onChange?.();
		},
		finishRefresh() {
			problemCount = source.match(/\bproblem\b/g)?.length ?? 0;
			diagnosticsSummary = summarize(problemCount);
			diagnosticsCurrent = true;
			options.onChange?.();
		},
		setSource(text) {
			this.setSourceCalls++;
			source = normalize(text);
			revision++;
			diagnosticsCurrent = false;
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
