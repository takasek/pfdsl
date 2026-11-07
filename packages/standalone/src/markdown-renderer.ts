import { StandaloneServices } from "monaco-editor/editor/standalone/browser/standaloneServices.js";
import {
	IMarkdownRendererService,
	MarkdownRendererService,
} from "monaco-editor/platform/markdown/browser/markdownRenderer.js";
import { IOpenerService } from "monaco-editor/platform/opener/common/opener.js";

class TableHeaderMarkdownRenderer extends MarkdownRendererService {
	override render(...args: Parameters<MarkdownRendererService["render"]>) {
		const rendered = super.render(...args);
		// WebKitGTK 2.54.0 aborts in AT-SPI GetRoleName for implicit headers.
		// Monaco strips authored role attributes, so decorate its sanitized DOM
		// synchronously, before the hover inserts it into the document (#1513).
		// GFM table headings are columns. Do not guess roles for body/foot cells.
		for (const cell of rendered.element.querySelectorAll("thead > tr > th"))
			cell.setAttribute("role", "columnheader");
		return rendered;
	}
}

/** Install before any language/model API initializes Monaco's singleton services. */
export function registerMarkdownRenderer(): void {
	const renderer = new TableHeaderMarkdownRenderer({
		// Resolve the real opener only when used, after service initialization.
		open: (link, options) =>
			StandaloneServices.get(IOpenerService).open(link, options),
	});
	StandaloneServices.initialize({
		[IMarkdownRendererService.toString()]: renderer,
	});
}
