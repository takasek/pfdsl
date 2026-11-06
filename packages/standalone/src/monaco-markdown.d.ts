// Monaco 0.57.0 ships these internal modules without declarations. Keep this
// adapter's surface narrow; the real-module integration test checks the wiring.
declare module "monaco-editor/platform/markdown/browser/markdownRenderer.js" {
	import type { IMarkdownString } from "monaco-editor/editor/editor.api.js";

	export const IMarkdownRendererService: { toString(): string };
	export class MarkdownRendererService {
		constructor(opener: {
			open(link: string, options: unknown): Promise<boolean>;
		});
		render(
			markdown: IMarkdownString,
			options?: object,
			outElement?: HTMLElement,
		): { element: HTMLElement; dispose(): void };
	}
}

declare module "monaco-editor/platform/opener/common/opener.js" {
	export const IOpenerService: unique symbol;
}

declare module "monaco-editor/editor/standalone/browser/standaloneServices.js" {
	import type { IOpenerService } from "monaco-editor/platform/opener/common/opener.js";
	export const StandaloneServices: {
		initialize(overrides: Record<string, unknown>): unknown;
		get(id: typeof IOpenerService): {
			open(link: string, options: unknown): Promise<boolean>;
		};
	};
}
