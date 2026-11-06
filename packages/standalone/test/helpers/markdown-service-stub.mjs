// Controlled editor boundaries never render Markdown. Real renderer coverage
// lives in monaco-menu.test.mjs and usability-browser.mjs.
export const IMarkdownRendererService = "markdownRendererService";
export const IOpenerService = "openerService";
export class MarkdownRendererService {
	render() {
		throw new Error("Use the real Monaco harness to test Markdown rendering");
	}
}
export const StandaloneServices = {
	initialize() {},
	get() {
		throw new Error(
			"Controlled editor boundaries do not expose Monaco services",
		);
	},
};
