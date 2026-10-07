import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { refineNativeWorktreeRelation } from "./native-worktree-owner.mjs";
import { resolveGitRoots } from "./run-exec.mjs";

/** Resolve components in order: resolving '..' before symlinks changes meaning. */
export function resolvePhysicalPath(path, cwd) {
	if (typeof path !== "string" || !path || path.includes("\0"))
		throw new Error("Cannot resolve file target");
	if (!isAbsolute(path) && (typeof cwd !== "string" || !isAbsolute(cwd)))
		throw new Error("Relative file target has no absolute cwd");
	const absolute = isAbsolute(path) ? path : `${cwd}/${path}`;
	let current = "/";
	for (const part of absolute.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			current = dirname(current);
			continue;
		}
		const next = join(current, part);
		try {
			lstatSync(next);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			current = next;
			continue;
		}
		// A dangling symlink is not an absent new file: realpath must fail.
		current = realpathSync(next);
	}
	return current;
}

/** Convert all supported writes into Edit/Write operations with physical paths. */
export function normalizeFileOperations(
	payload,
	{ physicalPath = resolvePhysicalPath } = {},
) {
	const name = payload?.tool_name;
	if (!["Edit", "Write", "apply_patch"].includes(name)) return [];
	const input = payload?.tool_input;
	const operation = (tool, path, text = {}) => ({
		...payload,
		tool_name: tool,
		tool_input: { ...text, file_path: physicalPath(path, payload.cwd) },
	});
	if (name !== "apply_patch") return [operation(name, input?.file_path, input)];
	const text = input?.command;
	if (typeof text !== "string")
		throw new Error("apply_patch requires a command string");
	const lines = text.trimEnd().split("\n");
	if (lines.shift() !== "*** Begin Patch" || lines.pop() !== "*** End Patch")
		throw new Error("Invalid apply_patch envelope");
	const operations = [];
	for (let i = 0; i < lines.length; ) {
		const header = lines[i++].match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
		if (!header) throw new Error("Unsupported apply_patch file directive");
		const [, kind, path] = header;
		if (kind === "Delete") {
			operations.push(
				operation("Edit", path, { old_string: "", new_string: "" }),
			);
			continue;
		}
		let destination = path;
		if (kind === "Update" && lines[i]?.startsWith("*** Move to: "))
			destination = lines[i++].slice("*** Move to: ".length);
		const before = [],
			after = [];
		let hunk = kind === "Add";
		while (
			i < lines.length &&
			!/^\*\*\* (?:Add|Update|Delete) File: /.test(lines[i])
		) {
			const line = lines[i++];
			if (kind === "Update" && (line === "@@" || line.startsWith("@@ "))) {
				hunk = true;
				continue;
			}
			if (kind === "Update" && line === "*** End of File") continue;
			if (
				!hunk ||
				(kind === "Add" ? !line.startsWith("+") : !/^[ +-]/.test(line))
			)
				throw new Error("Unsupported apply_patch hunk");
			if (line[0] !== "+") before.push(line.slice(1));
			if (line[0] !== "-") after.push(line.slice(1));
		}
		if (!hunk) throw new Error("apply_patch update has no hunk");
		if (kind === "Add")
			operations.push(operation("Write", path, { content: after.join("\n") }));
		else {
			const changes = {
				old_string: before.join("\n"),
				new_string: after.join("\n"),
			};
			operations.push(operation("Edit", path, changes));
			if (destination !== path)
				operations.push(operation("Edit", destination, changes));
		}
	}
	if (!operations.length)
		throw new Error("apply_patch contains no file operations");
	return operations;
}

function existingParent(path) {
	let current = dirname(path);
	while (true) {
		try {
			if (lstatSync(current).isDirectory()) return current;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		const parent = dirname(current);
		if (parent === current) throw new Error("No existing file target parent");
		current = parent;
	}
}

const isUnder = (path, root) => path === root || path.startsWith(`${root}/`);

function hasRepositoryMarker(path) {
	for (let current = path; ; current = dirname(current)) {
		try {
			lstatSync(join(current, ".git"));
			return true;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (dirname(current) === current) return false;
	}
}

export function evaluatePhysicalWrites(
	payload,
	sessionRoots,
	{
		resolveRoots = resolveGitRoots,
		ownerRelation = (target, original) =>
			refineNativeWorktreeRelation(original, { targetRoot: target, payload }),
		operations = normalizeFileOperations(payload),
		supportsAsk = Boolean(process.env.CLAUDE_PROJECT_DIR?.trim()),
	} = {},
) {
	if (!operations.length) return { decision: "allow" };
	if (!sessionRoots)
		return {
			decision: "deny",
			reason:
				"Cannot establish the repository boundary for this write. Repair the Git root probe before retrying.",
		};
	for (const op of operations) {
		const path = op.tool_input.file_path;
		const target = resolveRoots(existingParent(path));
		if (!target) {
			if (
				isUnder(path, sessionRoots.mainRoot) ||
				isUnder(path, sessionRoots.worktreeRoot) ||
				hasRepositoryMarker(existingParent(path))
			)
				return {
					decision: "deny",
					reason:
						"Cannot establish this repository file target. Repair the target probe before retrying.",
				};
			continue;
		}
		if (target.commonDir !== sessionRoots.commonDir) continue;
		if (target.worktreeRoot === target.mainRoot)
			return {
				decision: "deny",
				reason: `Blocked write to the primary checkout: '${path}'. Edit the owned feature worktree instead.`,
			};
		// Codex cwd can follow cd. Linked checkouts require native ownership even
		// when cwd already reports that checkout; cwd is not a parent identity.
		const original =
			supportsAsk && target.worktreeRoot === sessionRoots.worktreeRoot
				? "own"
				: "sibling";
		if (ownerRelation(target.worktreeRoot, original) !== "own")
			return {
				decision: supportsAsk ? "ask" : "deny",
				reason: `Cannot confirm native ownership of '${target.worktreeRoot}' for this write. Directory changes do not establish ownership. Use an attached native worktree owned by this session.`,
			};
	}
	return { decision: "allow" };
}
