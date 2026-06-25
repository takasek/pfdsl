import type { Frontmatter } from "@pfdsl/core";

export function normalizeLocation(loc: unknown): string[] {
	if (typeof loc === "string" && loc) return [loc];
	if (Array.isArray(loc))
		return loc.filter(
			(v): v is string => typeof v === "string" && v.length > 0,
		);
	return [];
}

function formatField(key: string, value: string): string {
	const trimmed = value.trimEnd();
	if (trimmed.includes("\n")) {
		const indented = trimmed
			.split("\n")
			.map((l) => `  ${l}`)
			.join("\n");
		return `\n${key}:\n${indented}`;
	}
	return `\n${key}: ${trimmed}`;
}

export function buildDescriptions(
	fm: Frontmatter | null,
): Record<string, string> {
	const result: Record<string, string> = {};
	if (!fm) return result;
	for (const id of Object.keys(fm.artifact ?? {})) {
		const meta = fm.artifact?.[id];
		if (!meta) continue;
		const parts: string[] = [];
		if (meta.description) parts.push(meta.description.trimEnd());
		if (meta.owner) parts.push(formatField("owner", meta.owner));
		if (meta.externalStakeholders?.length)
			parts.push(
				formatField(
					"externalStakeholders",
					meta.externalStakeholders.join(", "),
				),
			);
		if (meta.status) parts.push(formatField("status", meta.status));
		if (meta.tags?.length)
			parts.push(formatField("tags", meta.tags.join(", ")));
		if (meta.parts?.length)
			parts.push(formatField("parts", meta.parts.join(", ")));
		if (meta.group) parts.push(formatField("group", meta.group));
		if (meta.criteria) parts.push(formatField("criteria", meta.criteria));
		const locs = normalizeLocation(meta.location);
		if (locs.length > 0) parts.push(formatField("location", locs.join(", ")));
		if (meta.revises) parts.push(formatField("revises", meta.revises));
		if (parts.length > 0) result[id] = parts.join("");
	}
	for (const id of Object.keys(fm.process ?? {})) {
		const meta = fm.process?.[id];
		if (!meta) continue;
		const parts: string[] = [];
		if (meta.description) parts.push(meta.description.trimEnd());
		if (meta.owner) parts.push(formatField("owner", meta.owner));
		if (meta.externalStakeholders?.length)
			parts.push(
				formatField(
					"externalStakeholders",
					meta.externalStakeholders.join(", "),
				),
			);
		if (meta.group) parts.push(formatField("group", meta.group));
		if (meta.tags?.length)
			parts.push(formatField("tags", meta.tags.join(", ")));
		if (meta.command) parts.push(formatField("command", meta.command));
		if (meta.subflow) parts.push(formatField("subflow", meta.subflow));
		if (parts.length > 0) result[id] = parts.join("");
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
