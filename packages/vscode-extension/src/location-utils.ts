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
): Record<string, Array<[string, string]>> {
	const result: Record<string, Array<[string, string]>> = {};
	if (!fm) return result;
	for (const id of Object.keys(fm.artifact ?? {})) {
		const meta = fm.artifact?.[id];
		if (!meta) continue;
		const rows: Array<[string, string]> = [];
		if (meta.label) rows.push(["**", meta.label]);
		if (meta.description) rows.push(["", meta.description.trimEnd()]);
		if (meta.owner) rows.push(["owner", meta.owner]);
		if (meta.externalStakeholders?.length)
			rows.push(["externalStakeholders", meta.externalStakeholders.join(", ")]);
		if (meta.status) rows.push(["status", meta.status]);
		if (meta.tags?.length) rows.push(["tags", meta.tags.join(", ")]);
		if (meta.parts?.length) rows.push(["parts", meta.parts.join(", ")]);
		if (meta.group) rows.push(["group", meta.group]);
		if (meta.criteria) rows.push(["criteria", meta.criteria]);
		const locs = normalizeLocation(meta.location);
		if (locs.length > 0) rows.push(["location", locs.join(", ")]);
		if (meta.revises) rows.push(["revises", meta.revises]);
		if (rows.length > 0) result[id] = rows;
	}
	for (const id of Object.keys(fm.process ?? {})) {
		const meta = fm.process?.[id];
		if (!meta) continue;
		const rows: Array<[string, string]> = [];
		if (meta.label) rows.push(["**", meta.label]);
		if (meta.description) rows.push(["", meta.description.trimEnd()]);
		if (meta.owner) rows.push(["owner", meta.owner]);
		if (meta.externalStakeholders?.length)
			rows.push(["externalStakeholders", meta.externalStakeholders.join(", ")]);
		if (meta.group) rows.push(["group", meta.group]);
		if (meta.tags?.length) rows.push(["tags", meta.tags.join(", ")]);
		if (meta.command) rows.push(["command", meta.command]);
		if (meta.subflow) rows.push(["subflow", meta.subflow]);
		const procLocs = normalizeLocation(meta.location);
		if (procLocs.length > 0) rows.push(["location", procLocs.join(", ")]);
		if (rows.length > 0) result[id] = rows;
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
