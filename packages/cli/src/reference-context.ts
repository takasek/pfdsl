import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	type Frontmatter,
	type ReferenceContext,
	type ReferenceFailure,
	resolveReference,
	validateReferenceContext,
} from "@pfdsl/core";
import type { CommandResult } from "./index.js";

export const STATIC_REFERENCE_NOTICE =
	"Reference resolution not checked (static analysis only).";

export function hasExplicitReferences(
	frontmatter: Frontmatter | null,
): boolean {
	return (
		frontmatter?.baseRef !== undefined ||
		Object.values(frontmatter?.artifact ?? {}).some(
			(node) => node.ref !== undefined,
		)
	);
}

export function readReferenceContext(
	path: string | undefined,
): { ok: true; context?: ReferenceContext } | ReferenceFailure {
	if (path === undefined) return { ok: true };
	try {
		return validateReferenceContext(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		return {
			ok: false,
			reason: "context-invalid",
			message: `Cannot read reference context: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function referenceFailureResult(
	failures: unknown[],
	json = false,
): CommandResult {
	const message = failures
		.map((failure) => {
			const value = failure as ReferenceFailure & { id?: string };
			return `${value.id ? `${value.id}: ` : ""}${value.reason}: ${value.message}`;
		})
		.join("\n");
	return json
		? {
				stdout: `${JSON.stringify({ ok: false, failures })}\n`,
				stderr: "",
				exitCode: 1,
			}
		: { stdout: "", stderr: `${message}\n`, exitCode: 1 };
}

function contained(root: string, path: string): boolean {
	const child = relative(root, path);
	return (
		child !== ".." &&
		!child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
		!isAbsolute(child)
	);
}

/** Inspect real paths even for a missing leaf: an existing symlink ancestor may escape. */
export function checkSnapshotPath(
	root: string,
	path: string,
	requireExists = true,
): ReferenceFailure | undefined {
	try {
		const actualRoot = realpathSync(root);
		let candidate = path;
		let missing = false;
		while (true) {
			try {
				lstatSync(candidate);
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				missing = true;
				const parent = dirname(candidate);
				if (parent === candidate) throw error;
				candidate = parent;
			}
		}
		if (!contained(actualRoot, realpathSync(candidate))) {
			return {
				ok: false,
				reason: "path-outside-root",
				code: "V039",
				message: "The resolved path leaves the selected snapshot.",
			};
		}
		if (missing && requireExists)
			return {
				ok: false,
				reason: "target-missing",
				message: `Target path does not exist: ${path}`,
			};
	} catch (error) {
		const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
		return {
			ok: false,
			reason: missing ? "target-missing" : "fetch-failed",
			message: `Cannot inspect snapshot path: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function resolveCheckedReference(
	input: Parameters<typeof resolveReference>[0],
) {
	const result = resolveReference(input);
	if (!result.ok || result.kind === "url" || !result.root) return result;
	// A glob is not expanded or accepted here, but an existing literal prefix must stay inside the collection.
	const glob = result.kind === "glob";
	const path = glob
		? result.value.slice(0, result.value.search(/[*?{]/))
		: result.value;
	const prefix =
		glob && !path.endsWith("/") && !path.endsWith("\\") ? dirname(path) : path;
	const failure = checkSnapshotPath(result.root, prefix, !glob);
	return failure ?? result;
}

/** Use a virtual entry at the logical position, reading its authored source separately. */
export function modelDependencyPath(
	file: string,
	frontmatter: Frontmatter | null,
	context: ReferenceContext | undefined,
) {
	if (!context) return { ok: true as const, path: resolve(file) };
	const hasDependencies =
		frontmatter?.extends !== undefined ||
		Object.values(frontmatter?.process ?? {}).some(
			(node) => node.subflow !== undefined,
		);
	if (!hasDependencies) return { ok: true as const, path: resolve(file) };
	const result = resolveReference({
		docPath: file,
		frontmatter,
		nodeKind: "process",
		nodeId: "",
		field: "extends",
		value: ".",
		context,
	});
	if (!result.ok) return result;
	if (!context.basis)
		return {
			ok: false as const,
			reason: "context-invalid" as const,
			message: "The model basis is required for dependencies.",
		};
	return {
		ok: true as const,
		path: resolve(
			context.basis.root,
			context.logicalPath.replaceAll("\\", "/"),
		),
	};
}
