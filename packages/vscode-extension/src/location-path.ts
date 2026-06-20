import { dirname, resolve } from "node:path";

/**
 * Resolve a `location:` file path against the directory of the containing
 * `.pfdsl` file. Per spec §15.8, relative paths are based on the location of
 * the `.pfdsl` file itself, not the workspace/project root. Absolute paths are
 * returned unchanged.
 */
export function resolveLocationFsPath(
	docFsPath: string,
	location: string,
): string {
	return resolve(dirname(docFsPath), location);
}
