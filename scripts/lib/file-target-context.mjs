// Resolve file edits by their actual targets. The session root establishes
// repository scope; it is not evidence that a checkout is owned by a session.
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import {
	resolveGitRoots,
	tryGit,
	withoutGitTargetEnvironment,
} from "./run-exec.mjs";

export function isFileEditTool(payload) {
	return ["Edit", "Write", "apply_patch"].includes(payload?.tool_name);
}

const invalidPatch = () => ({
	error:
		"Cannot resolve every apply_patch target. Use a valid patch with absolute Add/Update/Delete/Move paths.",
});

/** Extract all file targets without interpreting shell commands or programs. */
export function extractFileTargets(payload) {
	if (!isFileEditTool(payload)) return { paths: [] };
	if (payload.tool_name !== "apply_patch") {
		const path = payload?.tool_input?.file_path;
		if (typeof path !== "string" || !path || path.includes("\0")) {
			return {
				error: "Cannot resolve the file edit target. Specify a file_path.",
			};
		}
		if (isAbsolute(path)) return { paths: [path] };
		const cwd = payload?.cwd;
		if (typeof cwd !== "string" || !isAbsolute(cwd)) {
			return {
				error:
					"Cannot resolve the relative file edit target without an execution cwd. Use an absolute file_path.",
			};
		}
		// Do not normalize dot-dot before resolving symlink components.
		return { paths: [`${cwd}/${path}`] };
	}
	return extractPatchTargets(payload?.tool_input?.command);
}

function extractPatchTargets(command) {
	if (typeof command !== "string" || command.includes("\0"))
		return invalidPatch();
	const lines = command.replace(/\r\n/g, "\n").split("\n");
	if (lines.at(-1) === "") lines.pop();
	if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch")
		return invalidPatch();
	const paths = [];
	let operation = null;
	let bodyLines = 0;
	let moved = false;
	for (const line of lines) {
		const header =
			/^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/.exec(line);
		if (header) {
			const [, kind, path] = header;
			if (!isAbsolute(path)) return invalidPatch();
			if (kind === "Move to") {
				if (operation !== "Update File" || moved || bodyLines > 0)
					return invalidPatch();
				moved = true;
			} else {
				if (operation === "Update File" && bodyLines === 0)
					return invalidPatch();
				operation = kind;
				bodyLines = 0;
				moved = false;
			}
			paths.push(path);
			continue;
		}
		const validBody =
			operation === "Add File"
				? line.startsWith("+")
				: operation === "Update File" &&
					/^(?:[ +-]|@@(?: |$)|\*\*\* End of File$)/.test(line);
		if (!validBody) return invalidPatch();
		bodyLines++;
	}
	if (paths.length === 0 || (operation === "Update File" && bodyLines === 0))
		return invalidPatch();
	return { paths };
}

/** Preserve filesystem symlink semantics and support not-yet-created parents. */
export function resolveFilePath(path) {
	if (!isAbsolute(path)) throw new Error("File target is not absolute.");
	let resolved = "/";
	for (const component of path.split("/")) {
		if (!component || component === ".") continue;
		if (component === "..") {
			resolved = dirname(resolved);
			continue;
		}
		resolved = join(resolved, component);
		let stat;
		try {
			stat = lstatSync(resolved);
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		if (stat.isSymbolicLink()) resolved = realpathSync(resolved);
	}
	let cwd = dirname(resolved);
	while (true) {
		try {
			if (!lstatSync(cwd).isDirectory())
				throw new Error("File target parent is not a directory.");
			return { path: resolved, cwd };
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			cwd = dirname(cwd);
		}
	}
}

function findGitAncestor(cwd) {
	for (let directory = cwd; ; directory = dirname(directory)) {
		try {
			lstatSync(join(directory, ".git"));
			return directory;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (dirname(directory) === directory) return null;
	}
}

function canonicalRoots(cwd, resolveRoots, exec, environment) {
	if (typeof cwd !== "string" || !isAbsolute(cwd)) return null;
	try {
		const roots = resolveRoots(realpathSync(cwd), { environment, exec });
		if (!roots) return roots;
		return {
			...roots,
			worktreeRoot: realpathSync(roots.worktreeRoot),
			commonDir: realpathSync(roots.commonDir),
		};
	} catch {
		return null;
	}
}

function repositoryContext(cwd, gitAncestor, roots, exec, env) {
	if (!roots)
		return {
			roots,
			outsideRepository: roots === null && gitAncestor === null,
			currentBranch: undefined,
			mainBranch: "main",
		};
	const current = exec(["branch", "--show-current"], { cwd, env });
	const head = exec(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
		cwd,
		env,
	});
	return {
		roots,
		outsideRepository: false,
		currentBranch: current?.ok ? current.out.trim() : undefined,
		mainBranch: head?.ok ? head.out.trim().replace(/^origin\//, "") : "main",
	};
}

/**
 * Resolve the session's repository scope and each independently addressed file.
 * A failed Git lookup is distinct from a confirmed path outside any repository.
 */
export function resolveFileTargetContext(
	payload,
	{
		environment = process.env,
		resolveRoots = resolveGitRoots,
		exec = tryGit,
	} = {},
) {
	const extracted = extractFileTargets(payload);
	if (extracted.error || extracted.paths.length === 0)
		return { ...extracted, targets: [] };
	const env = withoutGitTargetEnvironment(environment);
	const probe = (args, options) =>
		exec(args, { ...options, captureStderr: true });
	const rootsFor = (cwd) => canonicalRoots(cwd, resolveRoots, probe, env);
	const projectDir = environment.CLAUDE_PROJECT_DIR;
	const sessionRoots = rootsFor(
		typeof projectDir === "string" && projectDir.trim()
			? projectDir
			: payload?.cwd,
	);
	const targets = [];
	// Discover each path's nearest .git boundary before sharing probes within
	// this call. Nested repositories and linked worktrees have their own marker
	// and cannot inherit a parent checkout's repository or branch classification.
	const directoryContexts = new Map();
	for (const path of extracted.paths) {
		try {
			const file = resolveFilePath(path);
			const gitAncestor = findGitAncestor(file.cwd);
			const contextKey = gitAncestor ?? file.cwd;
			let context = directoryContexts.get(contextKey);
			if (!context) {
				context = repositoryContext(
					file.cwd,
					gitAncestor,
					rootsFor(file.cwd),
					probe,
					env,
				);
				directoryContexts.set(contextKey, context);
			}
			targets.push({
				path: file.path,
				...context,
			});
		} catch {
			return {
				error: `Cannot resolve the filesystem target '${path}'. Use an absolute path with a readable existing parent.`,
				targets: [],
			};
		}
	}
	return { sessionRoots, targets };
}

/** Return known unrelated targets early; unresolved repository identity denies. */
export function fileTargetScope(target, sessionRoots) {
	if (target.outsideRepository) return "outside";
	if (!target.roots || !sessionRoots) return "unknown";
	return target.roots.commonDir === sessionRoots.commonDir ? "same" : "outside";
}
