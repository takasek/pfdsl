import type {
	ArtifactMeta,
	Frontmatter,
	NodeKind,
	ProcessMeta,
} from "./types/index.js";

export function resolveMeta(
	fm: Frontmatter | null | undefined,
	kind: NodeKind,
	id: string,
): ArtifactMeta | ProcessMeta | undefined {
	if (!fm) return undefined;
	return kind === "artifact" ? fm.artifact?.[id] : fm.process?.[id];
}
