import type { DiffReport } from "@pfdsl/core";
import { describe, expect, it } from "vitest";
import { buildDiffPanelHtml } from "./diff-panel.js";

function emptyReport(overrides: Partial<DiffReport> = {}): DiffReport {
	return {
		addedNodes: [],
		removedNodes: [],
		changedNodes: [],
		addedEdges: [],
		removedEdges: [],
		addedFeedback: [],
		removedFeedback: [],
		...overrides,
	};
}

describe("buildDiffPanelHtml", () => {
	it("renders a '~ node' line for each changed node", () => {
		const html = buildDiffPanelHtml(emptyReport({ changedNodes: ["spec"] }));

		expect(html).toContain("~ node  spec");
	});

	it("tags changed-node lines with the diff-change class", () => {
		const html = buildDiffPanelHtml(emptyReport({ changedNodes: ["spec"] }));

		expect(html).toContain('<div class="diff-change">~ node  spec</div>');
	});

	it("still renders added/removed nodes and edges alongside changed nodes", () => {
		const html = buildDiffPanelHtml(
			emptyReport({
				addedNodes: ["code"],
				removedNodes: ["draft"],
				changedNodes: ["spec"],
				addedEdges: ["spec -> code"],
			}),
		);

		expect(html).toContain('<div class="diff-add">+ node  code</div>');
		expect(html).toContain('<div class="diff-remove">- node  draft</div>');
		expect(html).toContain('<div class="diff-change">~ node  spec</div>');
		expect(html).toContain(
			'<div class="diff-add">+ edge  spec -&gt; code</div>',
		);
	});

	it("renders the no-differences message when the report is empty", () => {
		const html = buildDiffPanelHtml(emptyReport());

		expect(html).toBe(
			'<span class="diff-none">No structural differences</span>',
		);
	});

	it("escapes HTML-significant characters in node/edge text", () => {
		const html = buildDiffPanelHtml(emptyReport({ changedNodes: ["<a&b>"] }));

		expect(html).toContain("~ node  &lt;a&amp;b&gt;");
		expect(html).not.toContain("<a&b>");
	});
});
