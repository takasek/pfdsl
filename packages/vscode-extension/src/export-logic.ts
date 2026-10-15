/**
 * The path without its extension, which the "export all" flow appends to.
 * A leading dot is part of the name, not an extension — `.pfdslrc` keeps its
 * dot rather than collapsing to the directory.
 */
export function exportStem(fsPath: string): string {
	return fsPath.replace(/(?<=[^./\\])\.[^./\\]+$/, "");
}
