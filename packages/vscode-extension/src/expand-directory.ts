/**
 * Listing a `location:` directory for the "open which file?" pickers.
 *
 * Both the document-link command and the preview's openLocation handler need
 * it, and each had its own verbatim copy behind the coverage exclusions, so a
 * fix to one would not reach the other (#611). The directory access is passed
 * in rather than imported: the callers hold the vscode API, this file holds
 * the rule about what a directory expands to.
 */

/** What a directory listing yields, narrowed to the two kinds that matter here. */
export interface DirectoryEntry {
	name: string;
	isDirectory: boolean;
}

export interface DirectoryAccess {
	/** Entries of a directory; rejects or throws when it cannot be read. */
	read: (path: string) => Promise<DirectoryEntry[]>;
	/** Path of `name` inside `path`, in whatever form the caller wants back. */
	join: (path: string, name: string) => string;
}

/**
 * The files a directory offers. Descends one level per branch only when a
 * directory holds no files of its own, so a `location:` pointing at a folder
 * of folders still resolves to something openable without walking a deep tree.
 * An unreadable directory yields nothing rather than failing the caller.
 */
export async function expandDirectory(
	access: DirectoryAccess,
	dirPath: string,
): Promise<string[]> {
	let entries: DirectoryEntry[];
	try {
		entries = await access.read(dirPath);
	} catch {
		return [];
	}

	const files = entries
		.filter((e) => !e.isDirectory)
		.map((e) => access.join(dirPath, e.name));
	if (files.length > 0) return files;

	const nested: string[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory) continue;
		nested.push(
			...(await expandDirectory(access, access.join(dirPath, entry.name))),
		);
	}
	return nested;
}
