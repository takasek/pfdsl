import { fileURLToPath, pathToFileURL } from "node:url";
import { isUrlLike, type NodeKind, resolveLocationFsPath } from "@pfdsl/core";
import {
	buildHoverLines as buildSharedHoverLines,
	type DocumentModel,
	resolveDocumentReference,
} from "@pfdsl/editor";

export const RUN_COMMAND = "pfdsl._runProcessCommand";
const GOTO_COMMAND = "pfdsl._gotoNodeDefinition";
const OPEN_DIR_COMMAND = "pfdsl._openDirLocation";

function locationLink(docUri: string, loc: string, basePath?: string): string {
	const label = loc.replace(/[\\[\]]/g, "\\$&");
	const link = (uri: string) => `[${label}](${uri.replace(/[\\()]/g, "\\$&")})`;
	if (isUrlLike(loc)) return link(loc);
	// Unsaved and virtual documents have no filesystem base for these links.
	if (!docUri.startsWith("file:")) return label;
	const isDir = loc.endsWith("/");
	const absPath = resolveLocationFsPath(
		fileURLToPath(docUri),
		isDir ? loc.slice(0, -1) : loc,
		basePath,
	);
	if (isDir)
		return link(
			`command:${OPEN_DIR_COMMAND}?${encodeURIComponent(JSON.stringify([absPath]))}`,
		);
	return link(pathToFileURL(absPath).href);
}

export function buildHoverLines(
	id: string,
	kind: NodeKind,
	model: Pick<DocumentModel, "frontmatter" | "diagnostics">,
	docUri?: string,
): string[] {
	const { frontmatter } = model;
	return buildSharedHoverLines(
		id,
		kind,
		frontmatter,
		docUri
			? {
					node: (nodeId, icon) =>
						`[${icon} ${nodeId}](command:${GOTO_COMMAND}?${encodeURIComponent(JSON.stringify([docUri, nodeId]))})`,
					location: (loc) => {
						if (kind !== "group") {
							try {
								resolveDocumentReference(
									docUri.startsWith("file:") ? fileURLToPath(docUri) : null,
									{ kind, id, field: "location", value: loc },
									model,
								);
							} catch {
								return loc.replace(/[\\[\]]/g, "\\$&");
							}
						}
						return locationLink(docUri, loc, frontmatter?.basePath);
					},
					command: (command) =>
						`${command}  [▶ run](command:${RUN_COMMAND}?${encodeURIComponent(JSON.stringify([command, docUri, frontmatter?.basePath]))})`,
				}
			: undefined,
	);
}
