import type { Frontmatter } from "@pfdsl/core";

export function normalizeLocation(loc: unknown): string[] {
	if (typeof loc === "string" && loc) return [loc];
	if (Array.isArray(loc))
		return loc.filter(
			(v): v is string => typeof v === "string" && v.length > 0,
		);
	return [];
}

export function buildDescriptions(
	fm: Frontmatter | null,
): Record<string, string> {
	const result: Record<string, string> = {};
	if (!fm) return result;
	for (const id of Object.keys(fm.artifact ?? {})) {
		const meta = fm.artifact?.[id];
		const parts: string[] = [];
		if (meta?.description) parts.push(meta.description);
		if (meta?.criteria) parts.push(`criteria: ${meta.criteria}`);
		const locs = normalizeLocation(meta?.location);
		if (locs.length > 0) parts.push(`location: ${locs.join(", ")}`);
		if (parts.length > 0) result[id] = parts.join("\n");
	}
	for (const id of Object.keys(fm.process ?? {})) {
		const meta = fm.process?.[id];
		if (meta?.description) result[id] = meta.description;
	}
	return result;
}

export function buildLocations(
	fm: Frontmatter | null,
): Record<string, string[]> {
	const result: Record<string, string[]> = {};
	if (!fm) return result;
	for (const id of Object.keys(fm.artifact ?? {})) {
		const locs = normalizeLocation(fm.artifact?.[id]?.location);
		if (locs.length > 0) result[id] = locs;
	}
	for (const id of Object.keys(fm.process ?? {})) {
		const meta = fm.process?.[id];
		const rawLoc = meta?.location ?? meta?.subflow;
		const locs = normalizeLocation(rawLoc).filter((l) => !l.includes("://"));
		if (locs.length > 0) result[id] = locs;
	}
	return result;
}

export function buildSubflows(fm: Frontmatter | null): Record<string, string> {
	const result: Record<string, string> = {};
	if (!fm) return result;
	for (const id of Object.keys(fm.process ?? {})) {
		const meta = fm.process?.[id];
		if (!meta?.location && typeof meta?.subflow === "string" && meta.subflow)
			result[id] = meta.subflow;
	}
	return result;
}
