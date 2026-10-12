// Physical component resolver transplanted from dbcff6be's file-operation-policy.
// Policy decisions remain in the pure classifier/table; this helper observes fs.
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse } from "node:path";

export function resolvePhysicalPath(
	path,
	cwd,
	{ followFinalSymlink = true } = {},
) {
	if (typeof path !== "string" || !path || path.includes("\0"))
		throw new Error("Cannot resolve file target");
	if (!isAbsolute(path) && (typeof cwd !== "string" || !isAbsolute(cwd)))
		throw new Error("Relative file target has no absolute cwd");
	const absolute = isAbsolute(path) ? path : `${cwd}/${path}`;
	let current = parse(absolute).root;
	const parts = absolute.slice(current.length).split("/");
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (!part || part === ".") continue;
		if (part === "..") {
			current = dirname(current);
			continue;
		}
		const next = join(current, part);
		if (!followFinalSymlink && index === parts.length - 1) return next;
		try {
			lstatSync(next);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			current = next;
			continue;
		}
		// A dangling symlink is not an absent new file.
		current = realpathSync(next);
	}
	return current;
}
