import { hasErrors, sort } from "@pfdsl/core";
import type * as monaco from "monaco-editor/editor/editor.api.js";

const keys = ["topological", "group", "index", "id"] as const;
type SortKey = (typeof keys)[number];

export function registerMetadataSort(
	editor: monaco.editor.IStandaloneCodeEditor,
	reportStatus: (message: string) => void,
) {
	let disposed = false;
	let panel: HTMLFormElement | undefined;
	function close() {
		panel?.remove();
		panel = undefined;
		if (!disposed) editor.focus();
	}
	function apply(by: SortKey[]) {
		const model = editor.getModel();
		if (disposed || !model) return;
		const result = sort(model.getValue(), { by });
		if (hasErrors(result.diagnostics)) {
			reportStatus("Fix document diagnostics before sorting metadata.");
			return;
		}
		if (result.changed) {
			editor.pushUndoStop();
			editor.executeEdits("pfdsl.sort", [
				{ range: model.getFullModelRange(), text: result.output },
			]);
			editor.pushUndoStop();
		}
		close();
	}
	function show() {
		if (disposed) return;
		close();
		panel = document.createElement("form");
		panel.className = "metadata-sort";
		panel.setAttribute("role", "dialog");
		panel.setAttribute("aria-label", "Sort metadata");
		const title = document.createElement("strong");
		title.textContent = "Sort metadata — keys in priority order";
		panel.append(title);
		const selects = keys.map((_, index) => {
			const label = document.createElement("label");
			label.textContent = index === 0 ? "Primary key " : `Then ${index} `;
			const select = document.createElement("select");
			for (const value of ["", ...keys]) {
				const option = document.createElement("option");
				option.value = value;
				option.textContent = value || "None";
				select.append(option);
			}
			select.value = index === 0 ? "topological" : "";
			label.append(select);
			panel!.append(label);
			return select;
		});
		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.textContent = "Cancel";
		cancel.onclick = close;
		const submit = document.createElement("button");
		submit.type = "submit";
		submit.textContent = "Sort";
		panel.append(cancel, submit);
		panel.onsubmit = (event) => {
			event.preventDefault();
			const selected = selects
				.map((select) => select.value)
				.filter((value): value is SortKey => keys.includes(value as SortKey));
			if (!selected.length || new Set(selected).size !== selected.length) {
				reportStatus("Choose at least one key, without duplicate keys.");
				return;
			}
			apply(selected);
		};
		panel.onkeydown = (event) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopPropagation();
				close();
			}
		};
		editor.getContainerDomNode().parentElement!.append(panel);
		selects[0]!.focus();
	}
	const registrations = [
		editor.addAction({
			id: "pfdsl.sortMeta",
			label: "Sort metadata…",
			contextMenuGroupId: "pfdsl",
			contextMenuOrder: 6,
			run: show,
		}),
		...keys.map((key) =>
			editor.addAction({
				id: `pfdsl.sort.${key}`,
				label: `Sort metadata (${key})`,
				run: () => apply([key]),
			}),
		),
	];
	return {
		dispose() {
			disposed = true;
			close();
			for (const registration of registrations) registration.dispose();
		},
	};
}
