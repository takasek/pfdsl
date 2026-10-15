import type { ExportResult } from "@pfdsl/editor";
export type ExportResultPresenter = (
	name: string,
	revision: number,
	results: ExportResult[],
) => void;
/** Results outlive their originating tab and remain until explicitly dismissed. */
export function createExportResults(
	parent: HTMLElement,
	report: (message: string) => void,
): ExportResultPresenter {
	let panel: HTMLElement | undefined;
	return (name, revision, results) => {
		if (!panel) {
			panel = document.createElement("section");
			panel.className = "export-results";
			panel.setAttribute("aria-label", "Export results");
			parent.append(panel);
		}
		const batch = document.createElement("section");
		const heading = document.createElement("h2");
		heading.textContent = `${name} — export of editor revision ${revision}`;
		const close = document.createElement("button");
		close.textContent = "Dismiss";
		close.onclick = () => {
			batch.remove();
			if (!panel?.children.length) {
				panel?.remove();
				panel = undefined;
			}
		};
		const list = document.createElement("ul");
		for (const result of results) {
			const item = document.createElement("li");
			item.textContent = `${result.format.toUpperCase()}: ${result.status === "saved" ? `Saved ${result.savedPath}` : `${result.status}: ${result.error}`}${result.warnings.length ? ` — Warning: ${result.warnings.join("; ")}` : ""}`;
			list.append(item);
		}
		batch.append(heading, close, list);
		panel.append(batch);
		report(
			`Export ${name}: ${results.filter((r) => r.status === "saved").length}/${results.length} saved. See export results for paths and failures.`,
		);
	};
}
