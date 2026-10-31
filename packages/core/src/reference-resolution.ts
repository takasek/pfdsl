import { posix, win32 } from "node:path";
import { resolveLocationFsPath } from "./location-path.js";
import { isAbsolutePath, isUrlLike } from "./multifile.js";
import type { Frontmatter, ReferenceTarget } from "./types/frontmatter.js";

/** A resource collection already acquired and pinned by the caller. */
export interface ReferenceSnapshot {
	source: string;
	fixedRevision: string;
	root: string;
}

/** The authored selector and the snapshot fixed for this verification. */
export interface ReferenceBinding extends ReferenceSnapshot {
	revision: string;
}

/** Identity of the original model, independent of its extraction path or targets. */
export interface ModelOrigin {
	source: string;
	fixedRevision: string;
	documentId: string;
	extractionId: string;
}

export interface ReferenceContext {
	adapter: string;
	model: ModelOrigin;
	logicalPath: string;
	basis?: ReferenceSnapshot;
	targets: ReferenceBinding[];
}

/** Acquisition and existence failures are reported by consumers, never inferred here. */
export type ReferenceFailureReason =
	| "unsupported"
	| "source-unknown"
	| "revision-unknown"
	| "logical-path-missing"
	| "fixed-revision-missing"
	| "fetch-failed"
	| "target-missing"
	| "context-invalid"
	| "reference-invalid"
	| "absolute-path"
	| "path-outside-root";

export interface ReferenceFailure {
	ok: false;
	reason: ReferenceFailureReason;
	message: string;
	code?: "V039";
}

export type ArtifactSnapshotResult =
	| { ok: true; kind: "local" }
	| {
			ok: true;
			kind: "resource";
			snapshot: ReferenceSnapshot;
			reference?: ReferenceTarget;
	  }
	| ReferenceFailure;

export interface ResolveReferenceInput {
	docPath: string | null;
	frontmatter: Frontmatter | null;
	nodeKind: "artifact" | "process";
	nodeId: string;
	field: "location" | "command.cwd" | "subflow" | "extends";
	value: string;
	context?: ReferenceContext | undefined;
}

export type ReferenceResult =
	| {
			ok: true;
			kind: "local" | "resource" | "url" | "glob";
			value: string;
			logicalPath?: string;
			source?: string;
			fixedRevision?: string;
			root?: string;
			reference?: ReferenceTarget;
	  }
	| ReferenceFailure;

function failure(
	reason: ReferenceFailureReason,
	message: string,
): ReferenceFailure {
	return {
		ok: false,
		reason,
		message,
		...(reason === "absolute-path" || reason === "path-outside-root"
			? { code: "V039" as const }
			: {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

/** Logical paths use collection-relative separators on every host OS. */
function logicalPath(
	value: string,
	label: string,
): { ok: true; path: string } | ReferenceFailure {
	if (isAbsolutePath(value))
		return failure(
			"absolute-path",
			`${label} must be relative to its resource collection`,
		);
	if (value.includes("\0"))
		return failure("context-invalid", `${label} contains a null character`);
	const path = posix.normalize(value.replaceAll("\\", "/"));
	if (path === ".." || path.startsWith("../"))
		return failure(
			"path-outside-root",
			`${label} leaves its resource collection`,
		);
	return { ok: true, path };
}

function validateSnapshot(value: unknown): ReferenceFailure | undefined {
	if (!isRecord(value))
		return failure("context-invalid", "A reference snapshot must be an object");
	if (!isText(value.source))
		return failure(
			"source-unknown",
			"A reference snapshot has no source identifier",
		);
	if (!isText(value.fixedRevision))
		return failure(
			"fixed-revision-missing",
			"A reference snapshot has no fixed revision",
		);
	if (
		!isText(value.root) ||
		!/^(?:[\\/]|[a-z]:[\\/])/i.test(value.root) ||
		value.root.includes("\0")
	)
		return failure(
			"context-invalid",
			"A reference snapshot requires an absolute resource root",
		);
	return undefined;
}

/** Validate caller-supplied JSON without acquiring, refreshing or probing any resource. */
export function validateReferenceContext(
	value: unknown,
): { ok: true; context: ReferenceContext } | ReferenceFailure {
	if (!isRecord(value))
		return failure("context-invalid", "Reference context must be an object");
	if (!isText(value.adapter))
		return failure(
			"unsupported",
			"Reference context requires an identified acquisition adapter",
		);
	if (!isRecord(value.model))
		return failure(
			"context-invalid",
			"Reference context requires the original model identity",
		);
	if (!isText(value.model.source))
		return failure("source-unknown", "The original model source is unknown");
	if (!isText(value.model.fixedRevision))
		return failure(
			"fixed-revision-missing",
			"The original model requires a fixed revision",
		);
	if (!isText(value.model.documentId) || !isText(value.model.extractionId))
		return failure(
			"context-invalid",
			"The original model requires document and extraction identifiers",
		);
	if (!isText(value.logicalPath))
		return failure(
			"logical-path-missing",
			"The model's logical file position is missing",
		);
	const logical = logicalPath(
		value.logicalPath,
		"The model's logical file position",
	);
	if (!logical.ok) return logical;
	if (logical.path === ".")
		return failure(
			"logical-path-missing",
			"The model's logical file position must identify a file",
		);
	if (!Array.isArray(value.targets))
		return failure(
			"context-invalid",
			"Reference context requires an array of target bindings",
		);
	const selectors = new Map<string, Set<string>>();
	for (const target of value.targets) {
		const invalid = validateSnapshot(target);
		if (invalid) return invalid;
		const binding = target as ReferenceBinding;
		if (!isText(binding.revision))
			return failure(
				"revision-unknown",
				"A target binding has no revision selector",
			);
		const revisions = selectors.get(binding.source) ?? new Set<string>();
		if (revisions.has(binding.revision))
			return failure(
				"context-invalid",
				"Reference context has duplicate source/revision bindings",
			);
		revisions.add(binding.revision);
		selectors.set(binding.source, revisions);
	}
	if (value.basis !== undefined) {
		const invalid = validateSnapshot(value.basis);
		if (invalid) return invalid;
	}
	return { ok: true, context: value as unknown as ReferenceContext };
}

function authoredReference(frontmatter: Frontmatter | null, id: string) {
	const artifacts = frontmatter?.artifact;
	const artifact =
		artifacts && Object.hasOwn(artifacts, id) ? artifacts[id] : undefined;
	if (artifact && Object.hasOwn(artifact, "ref"))
		return { declared: true, value: artifact.ref };
	return {
		declared: frontmatter !== null && Object.hasOwn(frontmatter, "baseRef"),
		value: frontmatter?.baseRef,
	};
}

/** Select a validated declaration wholesale; no trimming, merging or parent inheritance. */
export function selectArtifactReference(
	frontmatter: Frontmatter | null,
	id: string,
): ReferenceTarget | undefined {
	return authoredReference(frontmatter, id).value as
		| ReferenceTarget
		| undefined;
}

function isReferenceTarget(value: unknown): value is ReferenceTarget {
	return (
		isRecord(value) &&
		Object.keys(value).length === 2 &&
		isText(value.source) &&
		isText(value.revision)
	);
}

/** Resolve target identity even for artifacts without any location or file evidence. */
export function resolveArtifactSnapshot(
	frontmatter: Frontmatter | null,
	id: string,
	context?: ReferenceContext,
): ArtifactSnapshotResult {
	const reference = authoredReference(frontmatter, id);
	if (reference.declared && !isReferenceTarget(reference.value))
		return failure(
			"reference-invalid",
			"Artifact reference requires exactly source and revision as nonblank strings",
		);
	if (context === undefined) {
		return reference.declared
			? failure(
					"unsupported",
					"Explicit artifact references require a supplied resolution context",
				)
			: { ok: true, kind: "local" };
	}
	const valid = validateReferenceContext(context);
	if (!valid.ok) return valid;
	if (!reference.declared) return resolveBasis(context);
	const target = reference.value as ReferenceTarget;
	const sources = context.targets.filter(
		(binding) => binding.source === target.source,
	);
	if (sources.length === 0)
		return failure(
			"source-unknown",
			"No supplied snapshot matches the artifact reference source",
		);
	const binding = sources.find(
		(candidate) => candidate.revision === target.revision,
	);
	if (!binding)
		return failure(
			"revision-unknown",
			"No supplied snapshot matches the artifact revision selector",
		);
	const { source, fixedRevision, root } = binding;
	return {
		ok: true,
		kind: "resource",
		snapshot: { source, fixedRevision, root },
		reference: target,
	};
}

function resolveBasis(context: ReferenceContext): ArtifactSnapshotResult {
	if (!context.basis)
		return failure(
			"source-unknown",
			"The model's reference basis was not supplied; its origin and artifact targets cannot substitute for it",
		);
	return { ok: true, kind: "resource", snapshot: context.basis };
}

/**
 * Resolve a path using only supplied identities and snapshots. This function
 * never reads files, acquires resources, resolves selectors, or expands globs.
 * Consumers must check real paths and expanded matches remain within `root`.
 */
export function resolveReference(
	input: ResolveReferenceInput,
): ReferenceResult {
	const { docPath, frontmatter, nodeKind, nodeId, field, value, context } =
		input;
	const crossFile = field === "subflow" || field === "extends";
	if (isUrlLike(value)) {
		return crossFile
			? failure("unsupported", `${field} does not support URL references`)
			: { ok: true, kind: "url", value };
	}
	if (crossFile && isAbsolutePath(value))
		return failure("absolute-path", `${field} requires a relative file path`);
	let selected: ArtifactSnapshotResult;
	if (nodeKind === "artifact" && field === "location") {
		selected = resolveArtifactSnapshot(frontmatter, nodeId, context);
	} else if (context !== undefined) {
		const valid = validateReferenceContext(context);
		if (!valid.ok) return valid;
		selected = resolveBasis(context);
	} else {
		selected = { ok: true, kind: "local" };
	}
	if (!selected.ok) return selected;
	const basePath = crossFile ? undefined : frontmatter?.basePath;
	const glob = /[*?{]/.test(value);
	if (selected.kind === "local") {
		if (!docPath)
			return failure(
				"logical-path-missing",
				"Local reference resolution requires the containing document path",
			);
		return {
			ok: true,
			kind: glob ? "glob" : "local",
			value: resolveLocationFsPath(docPath, value, basePath),
		};
	}
	// A resource selection can only succeed after validating a supplied context.
	const modelPath = context!.logicalPath.replaceAll("\\", "/");
	if (basePath && isAbsolutePath(basePath))
		return failure(
			"absolute-path",
			"basePath must be relative to the model's logical directory",
		);
	const base = logicalPath(
		posix.join(
			posix.dirname(modelPath),
			basePath?.replaceAll("\\", "/") ?? ".",
		),
		"basePath",
	);
	if (!base.ok) return base;
	if (isAbsolutePath(value))
		return failure(
			"absolute-path",
			"A resource reference cannot use an absolute file path",
		);
	const target = logicalPath(
		posix.join(base.path, value.replaceAll("\\", "/")),
		"The resolved reference",
	);
	if (!target.ok) return target;
	const { source, fixedRevision, root } = selected.snapshot;
	const paths = posix.isAbsolute(root) ? posix : win32;
	if (!paths)
		return failure(
			"unsupported",
			"This host cannot resolve Windows resource paths",
		);
	return {
		ok: true,
		kind: glob ? "glob" : "resource",
		value: paths.resolve(root, target.path),
		logicalPath: target.path,
		source,
		fixedRevision,
		root,
		...(selected.reference ? { reference: selected.reference } : {}),
	};
}
