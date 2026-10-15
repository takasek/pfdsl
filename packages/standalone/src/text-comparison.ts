import * as monaco from "monaco-editor/editor/editor.api.js";

/** Read-only, aligned line comparison. It has no path to document or disk mutation. */
export function createTextComparison(
	parent: HTMLElement,
	local: string,
	disk: string | null,
) {
	const labels = document.createElement("div");
	labels.className = "comparison-labels";
	for (const label of [
		"Editor content — retained until you choose",
		"Observed disk content — retained until a confirmed save",
	]) {
		const text = document.createElement("strong");
		text.textContent = label;
		labels.append(text);
	}
	const legend = document.createElement("p");
	legend.textContent =
		"− lines appear only in the editor; + lines appear only on the observed disk. Changes are marked in the gutter and aligned across both sides.";
	const surface = document.createElement("div");
	surface.className = "text-comparison";
	parent.append(labels, legend, surface);
	const original = monaco.editor.createModel(local, "pfdsl");
	const modified = monaco.editor.createModel(disk ?? "", "pfdsl");
	const editor = monaco.editor.createDiffEditor(surface, {
		readOnly: true,
		originalEditable: false,
		automaticLayout: true,
		renderSideBySide: true,
		useInlineViewWhenSpaceIsLimited: false,
		renderIndicators: true,
		renderOverviewRuler: true,
		accessibilityVerbose: true,
		originalAriaLabel: "Editor content (read only)",
		modifiedAriaLabel:
			disk === null
				? "Observed disk file is missing"
				: "Observed disk content (read only)",
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
	});
	editor.setModel({ original, modified });
	if (disk === null) {
		const notice = document.createElement("p");
		notice.textContent =
			"The disk file is missing. Editor content and the unresolved state are retained.";
		parent.append(notice);
	}
	return {
		dispose() {
			editor.dispose();
			original.dispose();
			modified.dispose();
		},
	};
}
