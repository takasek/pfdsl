import { describe, expect, it, vi } from "vitest";

// Browser builds alias node:path to path-browserify, whose win32 export is null.
vi.mock("node:path", async (original) => ({
	...(await original<typeof import("node:path")>()),
	win32: null,
}));

import { resolveReference } from "./reference-resolution.js";

describe("reference resolution with browser path support", () => {
	const context = {
		adapter: "supplied-snapshots",
		model: {
			source: "model",
			fixedRevision: "M1",
			documentId: "roadmap",
			extractionId: "block",
		},
		logicalPath: ".pfdsl/roadmap.pfdsl",
		basis: { source: "repo", fixedRevision: "C1", root: "/snapshots/C1" },
		targets: [],
	};
	it("resolves POSIX snapshots without calling the absent Windows implementation", () => {
		expect(
			resolveReference({
				docPath: null,
				frontmatter: { basePath: ".." },
				nodeKind: "artifact",
				nodeId: "a",
				field: "location",
				value: "docs/plan.md",
				context,
			}),
		).toMatchObject({ ok: true, value: "/snapshots/C1/docs/plan.md" });
	});
	it("resolves local relative subflows without calling the absent Windows implementation", () => {
		expect(
			resolveReference({
				docPath: "/work/a.pfdsl",
				frontmatter: null,
				nodeKind: "process",
				nodeId: "p",
				field: "subflow",
				value: "child.pfdsl",
			}),
		).toMatchObject({ ok: true, value: "/work/child.pfdsl" });
	});
	it("reports unsupported Windows snapshot resolution instead of throwing", () => {
		expect(
			resolveReference({
				docPath: null,
				frontmatter: null,
				nodeKind: "artifact",
				nodeId: "a",
				field: "location",
				value: "plan.md",
				context: {
					...context,
					basis: { ...context.basis, root: "C:\\snapshots\\C1" },
				},
			}),
		).toMatchObject({ ok: false, reason: "unsupported" });
	});
});
