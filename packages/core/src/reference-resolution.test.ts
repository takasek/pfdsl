import { describe, expect, it, vi } from "vitest";
import {
	type ReferenceContext,
	resolveArtifactSnapshot,
	resolveReference,
	selectArtifactReference,
	validateReferenceContext,
} from "./reference-resolution.js";
import type { Frontmatter } from "./types/frontmatter.js";

const source = "https://example.test/project.git";
const context: ReferenceContext = {
	adapter: "test-snapshots/v1",
	model: {
		source: "https://example.test/wiki.git",
		fixedRevision: "wiki-W",
		documentId: "Roadmap",
		extractionId: "pfdsl-block-2",
	},
	logicalPath: ".pfdsl/roadmap.pfdsl",
	basis: { source, fixedRevision: "commit-C0", root: "/snapshots/C0" },
	targets: [
		{
			source,
			revision: "main",
			fixedRevision: "commit-C1",
			root: "/snapshots/C1",
		},
		{
			source,
			revision: "develop",
			fixedRevision: "commit-C2",
			root: "/snapshots/C2",
		},
	],
};
const frontmatter: Frontmatter = {
	basePath: "..",
	baseRef: { source, revision: "main" },
	artifact: {
		accepted: { location: "docs/plan.md" },
		working: { location: "docs/plan.md", ref: { source, revision: "develop" } },
	},
};
function resolve(
	overrides: Partial<Parameters<typeof resolveReference>[0]> = {},
) {
	return resolveReference({
		docPath: "/temporary/extracted.pfdsl",
		frontmatter,
		nodeKind: "artifact",
		nodeId: "accepted",
		field: "location",
		value: "docs/plan.md",
		context,
		...overrides,
	});
}

describe("reference target selection", () => {
	it("preserves directory locations under an explicit target", () => {
		expect(resolve({ value: "docs/" })).toMatchObject({
			ok: true,
			value: "/snapshots/C1/docs",
		});
	});
	it("resolves the same logical path in distinct fixed snapshots", () => {
		expect(resolve()).toEqual({
			ok: true,
			kind: "resource",
			value: "/snapshots/C1/docs/plan.md",
			logicalPath: "docs/plan.md",
			source,
			fixedRevision: "commit-C1",
			root: "/snapshots/C1",
			reference: { source, revision: "main" },
		});
		expect(resolve({ nodeId: "working" })).toMatchObject({
			ok: true,
			value: "/snapshots/C2/docs/plan.md",
			fixedRevision: "commit-C2",
			reference: { source, revision: "develop" },
		});
	});

	it("replaces the whole reference mapping and never repairs a partial override", () => {
		const overridden: Frontmatter = {
			...frontmatter,
			artifact: {
				accepted: {
					ref: { source: "another-collection", revision: "published" },
				},
			},
		};
		expect(selectArtifactReference(overridden, "accepted")).toEqual({
			source: "another-collection",
			revision: "published",
		});
		expect(resolve({ frontmatter: overridden })).toMatchObject({
			ok: false,
			reason: "source-unknown",
		});
		const malformed = {
			...frontmatter,
			artifact: { accepted: { ref: { revision: "develop" } } },
		} as unknown as Frontmatter;
		expect(resolve({ frontmatter: malformed })).toMatchObject({
			ok: false,
			reason: "reference-invalid",
		});
	});

	it("validates targets even when an artifact has no location", () => {
		expect(resolveArtifactSnapshot(frontmatter, "accepted", context)).toEqual({
			ok: true,
			kind: "resource",
			snapshot: { source, fixedRevision: "commit-C1", root: "/snapshots/C1" },
			reference: { source, revision: "main" },
		});
		expect(resolveArtifactSnapshot(frontmatter, "accepted")).toMatchObject({
			ok: false,
			reason: "unsupported",
		});
		expect(resolveArtifactSnapshot(null, "accepted")).toEqual({
			ok: true,
			kind: "local",
		});
		expect(selectArtifactReference(null, "accepted")).toBeUndefined();
	});

	it("requires an exact selector without trimming or substituting the model revision", () => {
		expect(
			resolve({ frontmatter: { baseRef: { source, revision: " main " } } }),
		).toMatchObject({ ok: false, reason: "revision-unknown" });
		expect(resolve({ context: { ...context, targets: [] } })).toMatchObject({
			ok: false,
			reason: "source-unknown",
		});
	});
});

describe("model basis and compatibility", () => {
	it("keeps process paths and cwd at C0 while artifacts select C1", () => {
		expect(
			resolve({ nodeKind: "process", value: "scripts/review.mjs" }),
		).toEqual({
			ok: true,
			kind: "resource",
			value: "/snapshots/C0/scripts/review.mjs",
			logicalPath: "scripts/review.mjs",
			source,
			fixedRevision: "commit-C0",
			root: "/snapshots/C0",
		});
		expect(
			resolve({ nodeKind: "process", field: "command.cwd", value: "." }),
		).toMatchObject({
			ok: true,
			value: "/snapshots/C0",
			logicalPath: ".",
			fixedRevision: "commit-C0",
		});
	});

	it.each([
		"subflow",
		"extends",
	] as const)("resolves %s from the logical directory without basePath or target inheritance", (field) => {
		expect(resolve({ field, value: "./child.pfdsl" })).toMatchObject({
			ok: true,
			value: "/snapshots/C0/.pfdsl/child.pfdsl",
			fixedRevision: "commit-C0",
		});
	});

	it("uses an artifact's own declarations, or the model basis when none exist", () => {
		expect(resolve({ frontmatter: {} })).toMatchObject({
			ok: true,
			value: "/snapshots/C0/.pfdsl/docs/plan.md",
			fixedRevision: "commit-C0",
		});
	});

	it("does not derive a missing basis or logical position from the extraction path or baseRef", () => {
		const { basis: _basis, ...withoutBasis } = context;
		expect(
			resolve({ context: withoutBasis, nodeKind: "process" }),
		).toMatchObject({ ok: false, reason: "source-unknown" });
		expect(resolve({ context: { ...context, logicalPath: "" } })).toMatchObject(
			{ ok: false, reason: "logical-path-missing" },
		);
	});

	it("preserves legacy relative, absolute, absolute-basePath and no-frontmatter behavior", () => {
		const legacy = { context: undefined, frontmatter: { basePath: ".." } };
		expect(
			resolve({ ...legacy, docPath: "/repo/.pfdsl/roadmap.pfdsl" }),
		).toEqual({ ok: true, kind: "local", value: "/repo/docs/plan.md" });
		expect(resolve({ ...legacy, value: "/etc/hosts" })).toEqual({
			ok: true,
			kind: "local",
			value: "/etc/hosts",
		});
		expect(
			resolve({ context: undefined, frontmatter: { basePath: "/ignored" } }),
		).toEqual({ ok: true, kind: "local", value: "/temporary/docs/plan.md" });
		expect(resolve({ context: undefined, frontmatter: null })).toEqual({
			ok: true,
			kind: "local",
			value: "/temporary/docs/plan.md",
		});
		expect(
			resolve({ ...legacy, field: "extends", value: "child.yaml" }),
		).toEqual({ ok: true, kind: "local", value: "/temporary/child.yaml" });
	});

	it("fails without a document path or the required explicit context", () => {
		expect(resolve({ context: undefined })).toMatchObject({
			ok: false,
			reason: "unsupported",
		});
		expect(
			resolve({ context: undefined, frontmatter: null, docPath: null }),
		).toMatchObject({ ok: false, reason: "logical-path-missing" });
	});

	it.each([
		"artifact",
		"process",
	] as const)("rejects a malformed supplied context for %s instead of falling back locally", (nodeKind) => {
		expect(
			resolve({
				frontmatter: null,
				context: null as unknown as ReferenceContext,
				nodeKind,
			}),
		).toMatchObject({ ok: false, reason: "context-invalid" });
	});
});

describe("collection boundaries and non-file locations", () => {
	it.each([
		"/etc/hosts",
		"C:\\Windows\\file",
		"C:/Windows/file",
		"\\\\server\\share\\file",
		"C:relative",
	])("rejects the absolute or drive-qualified path %s", (value) => {
		expect(resolve({ value })).toMatchObject({
			ok: false,
			reason: "absolute-path",
			code: "V039",
		});
	});

	it.each([
		{ value: "../outside" },
		{ value: "..\\outside" },
		{ frontmatter: { ...frontmatter, basePath: "../.." } },
		{ context: { ...context, logicalPath: "../roadmap.pfdsl" } },
		{ context: { ...context, logicalPath: "x/../../roadmap.pfdsl" } },
	])("rejects traversal outside the selected collection: %j", (overrides) => {
		expect(resolve(overrides)).toMatchObject({
			ok: false,
			reason: "path-outside-root",
			code: "V039",
		});
	});

	it.each([
		"/etc",
		"D:\\elsewhere",
	])("rejects absolute basePath %s", (basePath) => {
		expect(
			resolve({ frontmatter: { ...frontmatter, basePath } }),
		).toMatchObject({ ok: false, code: "V039" });
	});

	it("normalizes in-collection parent segments and Windows roots without consulting the filesystem", () => {
		expect(resolve({ value: "draft/../docs/plan.md" })).toMatchObject({
			ok: true,
			logicalPath: "docs/plan.md",
		});
		const windows = {
			...context,
			targets: [
				{
					source,
					revision: "main",
					fixedRevision: "C1",
					root: "C:\\snapshots\\C1",
				},
			],
		};
		expect(resolve({ context: windows, value: "docs\\plan.md" })).toMatchObject(
			{
				ok: true,
				value: "C:\\snapshots\\C1\\docs\\plan.md",
				logicalPath: "docs/plan.md",
			},
		);
	});

	it("leaves self-contained URLs unchanged without a context", () => {
		expect(
			resolve({
				context: undefined,
				value: "https://example.test/docs/plan.md",
			}),
		).toEqual({
			ok: true,
			kind: "url",
			value: "https://example.test/docs/plan.md",
		});
	});

	it("returns an unexpanded glob constrained to the selected root", () => {
		expect(resolve({ value: "docs/**/*.md" })).toMatchObject({
			ok: true,
			kind: "glob",
			value: "/snapshots/C1/docs/**/*.md",
			root: "/snapshots/C1",
		});
		expect(resolve({ value: "../**/*.md" })).toMatchObject({
			ok: false,
			code: "V039",
		});
		expect(
			resolve({ context: undefined, frontmatter: null, value: "docs/*.md" }),
		).toEqual({ ok: true, kind: "glob", value: "/temporary/docs/*.md" });
	});

	it.each([
		"subflow",
		"extends",
	] as const)("retains %s URL and absolute-path rejection", (field) => {
		expect(
			resolve({ field, value: "https://example.test/child.pfdsl" }),
		).toMatchObject({ ok: false, reason: "unsupported" });
		expect(
			resolve({
				context: undefined,
				frontmatter: null,
				field,
				value: "/child.pfdsl",
			}),
		).toMatchObject({ ok: false, reason: "absolute-path" });
	});

	it("does not fetch or require a model/file to exist in the target snapshot", () => {
		const fetch = vi.fn(() => {
			throw new Error("must not fetch");
		});
		vi.stubGlobal("fetch", fetch);
		try {
			expect(resolve({ value: "does-not-exist-anywhere.md" })).toMatchObject({
				ok: true,
			});
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("reference context validation", () => {
	it("accepts complete model identity, basis and fixed target bindings", () => {
		expect(validateReferenceContext(context)).toEqual({ ok: true, context });
	});

	it.each([
		[null, "context-invalid"],
		[{ ...context, adapter: " " }, "unsupported"],
		[{ ...context, model: null }, "context-invalid"],
		[{ ...context, model: { ...context.model, source: "" } }, "source-unknown"],
		[
			{ ...context, model: { ...context.model, fixedRevision: " " } },
			"fixed-revision-missing",
		],
		[
			{ ...context, model: { ...context.model, documentId: "" } },
			"context-invalid",
		],
		[
			{ ...context, model: { ...context.model, extractionId: "" } },
			"context-invalid",
		],
		[{ ...context, logicalPath: "" }, "logical-path-missing"],
		[{ ...context, logicalPath: "." }, "logical-path-missing"],
		[{ ...context, logicalPath: "a/" }, "logical-path-missing"],
		[{ ...context, logicalPath: "a\\" }, "logical-path-missing"],
		[{ ...context, logicalPath: "./" }, "logical-path-missing"],
		[{ ...context, logicalPath: "docs/\0roadmap.pfdsl" }, "context-invalid"],
		[{ ...context, logicalPath: "/absolute/roadmap.pfdsl" }, "absolute-path"],
		[{ ...context, targets: null }, "context-invalid"],
		[{ ...context, targets: [null] }, "context-invalid"],
		[
			{ ...context, targets: [{ ...context.targets[0], source: " " }] },
			"source-unknown",
		],
		[
			{ ...context, targets: [{ ...context.targets[0], revision: "" }] },
			"revision-unknown",
		],
		[
			{ ...context, targets: [{ ...context.targets[0], fixedRevision: "" }] },
			"fixed-revision-missing",
		],
		[
			{ ...context, targets: [{ ...context.targets[0], root: "" }] },
			"context-invalid",
		],
		[
			{
				...context,
				targets: [{ ...context.targets[0], root: "relative/root" }],
			},
			"context-invalid",
		],
		[
			{ ...context, targets: [context.targets[0], context.targets[0]] },
			"context-invalid",
		],
		[{ ...context, basis: {} }, "source-unknown"],
	])("distinguishes incomplete or ambiguous context: %j", (value, reason) => {
		expect(validateReferenceContext(value)).toMatchObject({
			ok: false,
			reason,
		});
	});
});
