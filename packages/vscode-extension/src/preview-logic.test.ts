import { describe, expect, it } from "vitest";
import { buildHtml } from "./preview-logic.js";

describe("buildHtml", () => {
	const html = buildHtml(
		"https://example/webview.js",
		"https://cdn.example",
		false,
	);

	it("embeds the script URI as a module script", () => {
		expect(html).toContain(
			'<script type="module" src="https://example/webview.js"></script>',
		);
	});

	// The webview runs with scripts enabled, so the policy is what keeps a
	// crafted .pfdsl from reaching anything but our own bundle.
	describe("content security policy", () => {
		const csp =
			html.match(
				/http-equiv="Content-Security-Policy" content="([^"]+)"/,
			)?.[1] ?? "";

		it("denies everything by default", () => {
			expect(csp).toContain("default-src 'none'");
		});

		it("allows scripts only from the webview's own cspSource", () => {
			expect(csp).toContain(
				"script-src https://cdn.example 'wasm-unsafe-eval'",
			);
		});

		it("allows connections only to that same source", () => {
			expect(csp).toContain("connect-src https://cdn.example");
		});

		it("allows images only as inline data, never fetched from a host", () => {
			expect(csp).toContain("img-src data:");
			expect(csp).not.toMatch(/img-src[^;]*https?:\/\//);
		});
	});

	it("declares the mount points the webview script attaches to", () => {
		for (const id of ["root", "inner", "tooltip", "diff-panel", "minimap"]) {
			expect(html).toContain(`id="${id}"`);
		}
	});

	it("exposes the debug flag to the webview", () => {
		expect(buildHtml("s", "c", true)).toContain(
			"window.__PFDSL_DEBUG__ = true;",
		);
		expect(buildHtml("s", "c", false)).toContain(
			"window.__PFDSL_DEBUG__ = false;",
		);
	});
});
