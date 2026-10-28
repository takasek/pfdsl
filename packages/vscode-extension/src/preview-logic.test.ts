import { describe, expect, it } from "vitest";
import { buildHtml } from "./preview-logic.js";

describe("buildHtml", () => {
	const html = buildHtml("https://example/webview.js", "https://cdn.example");

	it("embeds the script URI as a module script", () => {
		expect(html).toContain(
			'<script type="module" src="https://example/webview.js"></script>',
		);
	});

	// The webview runs with scripts enabled, so the policy is what keeps a
	// crafted .pfdsl from reaching anything but our own bundle.
	it("allows only the declared webview resource sources in its content security policy", () => {
		const policies = [
			...html.matchAll(
				/http-equiv="Content-Security-Policy" content="([^"]+)"/g,
			),
		];
		expect(policies).toHaveLength(1);
		const directives = policies[0]![1]!
			.split(";")
			.map((directive) => directive.trim().split(/\s+/).join(" "))
			.filter(Boolean)
			.sort();
		expect(directives).toEqual([
			"connect-src https://cdn.example",
			"default-src 'none'",
			"img-src data:",
			"script-src https://cdn.example 'wasm-unsafe-eval'",
			"style-src 'unsafe-inline'",
		]);
	});

	it("declares the mount points the webview script attaches to", () => {
		for (const id of ["root", "inner", "tooltip", "diff-panel", "minimap"]) {
			expect(html).toContain(`id="${id}"`);
		}
	});
});
