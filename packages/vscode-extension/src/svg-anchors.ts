/**
 * Replace every `<a>` element under `root` with its child nodes.
 *
 * Graphviz wraps URL nodes in SVG `<a>` elements. VSCode's webview
 * `handleInnerClick` posts `SVGAElement.href` (an un-cloneable
 * SVGAnimatedString) whenever a click lands inside an anchor, throwing
 * DataCloneError. Stripping the href attribute is insufficient because the
 * `.href` property persists, so the anchor element itself must be removed.
 */
export function unwrapAnchors(root: ParentNode): void {
	for (const a of root.querySelectorAll("a")) {
		const parent = a.parentNode;
		if (!parent) continue;
		while (a.firstChild) parent.insertBefore(a.firstChild, a);
		parent.removeChild(a);
	}
}
