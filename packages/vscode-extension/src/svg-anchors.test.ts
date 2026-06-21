// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { unwrapAnchors } from "./svg-anchors.js";

/**
 * Graphviz emits URL nodes as `<g class="node"><g><a xlink:href>…</a></g></g>`.
 * VSCode's webview `handleInnerClick` crashes (DataCloneError) when a click
 * lands inside any `<a>`, because `SVGAElement.href` is an un-cloneable
 * SVGAnimatedString. Removing the href attribute is not enough — the property
 * survives — so the `<a>` element itself must be unwrapped.
 */
describe("unwrapAnchors", () => {
	it("removes anchor elements while keeping their children", () => {
		const root = document.createElement("div");
		root.innerHTML =
			'<g class="node"><a href="https://e.com"><ellipse></ellipse><text>x</text></a></g>';

		unwrapAnchors(root);

		expect(root.querySelector("a")).toBeNull();
		expect(root.querySelector("ellipse")).not.toBeNull();
		expect(root.querySelector("text")?.textContent).toBe("x");
	});

	it("unwraps nested anchors anywhere under the root", () => {
		const root = document.createElement("div");
		root.innerHTML =
			'<g class="node"><g><a href="https://e.com"><ellipse></ellipse></a></g></g>';

		unwrapAnchors(root);

		expect(root.querySelector("a")).toBeNull();
		expect(root.querySelector("g.node ellipse")).not.toBeNull();
	});
});
