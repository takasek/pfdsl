import { dirname, isAbsolute, resolve } from "node:path";

/**
 * Resolve a `location:` file path against the base directory for the containing
 * `.pfdsl` file. Per spec §15.8, relative paths are resolved against the base:
 * when `basePath` is provided it is first resolved relative to the `.pfdsl`
 * file's directory, and that result is used as the base; otherwise the
 * `.pfdsl` file's directory is used directly. Absolute paths are returned
 * unchanged. Per spec §2.3, `basePath` itself must be relative — an absolute
 * `basePath` is ignored and the `.pfdsl` file's directory is used instead.
 */
export function resolveLocationFsPath(
	docFsPath: string,
	location: string,
	basePath?: string,
): string {
	const base =
		basePath && !isAbsolute(basePath)
			? resolve(dirname(docFsPath), basePath)
			: dirname(docFsPath);
	return resolve(base, location);
}
