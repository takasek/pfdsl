import type {
	ArtifactMeta,
	Frontmatter,
	GroupMeta,
	NodeKind,
	ProcessMeta,
} from "./types/index.js";

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
