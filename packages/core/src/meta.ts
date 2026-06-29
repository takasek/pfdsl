import type {
	ArtifactMeta,
	Frontmatter,
	GroupMeta,
	NodeKind,
	ProcessMeta,
} from "./types/index.js";

export function resolveMeta(
	fm: Frontmatter | null | undefined,
	kind: "artifact",
	id: string,
): ArtifactMeta | undefined;
export function resolveMeta(
	fm: Frontmatter | null | undefined,
	kind: "process",
	id: string,
): ProcessMeta | undefined;
export function resolveMeta(
	fm: Frontmatter | null | undefined,
	kind: "group",
	id: string,
): GroupMeta | undefined;
export function resolveMeta(
	fm: Frontmatter | null | undefined,
	kind: "artifact" | "process",
	id: string,
): ArtifactMeta | ProcessMeta | undefined;
export function resolveMeta(
	fm: Frontmatter | null | undefined,
	kind: NodeKind,
	id: string,
): ArtifactMeta | ProcessMeta | GroupMeta | undefined;
export function resolveMeta(
	fm: Frontmatter | null | undefined,
	kind: NodeKind,
	id: string,
): ArtifactMeta | ProcessMeta | GroupMeta | undefined {
	if (!fm) return undefined;
	if (kind === "artifact") return fm.artifact?.[id];
	if (kind === "group") return fm.group?.[id];
	return fm.process?.[id];
}
