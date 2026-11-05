interface NamedTarget {
	name: string;
	path?: string | null;
}

/** The tab strip's naming rule, shared with recent items and status text. */
export function displayName(
	entry: NamedTarget,
	entries: readonly NamedTarget[],
): string {
	const sameName = entries.filter((other) => other.name === entry.name);
	let visibleName = entry.name;
	if (sameName.length > 1 && entry.path) {
		const parents = sameName
			.filter((other) => other.path)
			.map((other) => other.path!.split("/").slice(0, -1));
		const parent = entry.path.split("/").slice(0, -1);
		let depth = 1;
		while (
			depth < parent.length &&
			parents.filter(
				(parts) =>
					parts.slice(-depth).join("/") === parent.slice(-depth).join("/"),
			).length > 1
		)
			depth++;
		visibleName += ` — ${parent.slice(-depth).join("/") || "/"}`;
	}
	return visibleName;
}
