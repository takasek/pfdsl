import { fileURLToPath, pathToFileURL } from "node:url";
import {
	type Frontmatter,
	isUrlLike,
	type NodeKind,
	resolveLocationFsPath,
} from "@pfdsl/core";
import { buildHoverLines as buildSharedHoverLines } from "@pfdsl/editor";

export const RUN_COMMAND = "pfdsl._runProcessCommand";
const GOTO_COMMAND = "pfdsl._gotoNodeDefinition";
const OPEN_DIR_COMMAND = "pfdsl._openDirLocation";

function locationLink(docUri: string, loc: string, basePath?: string): string {
	const label = loc.replace(/[\\[\]]/g, "\\$&");
	const link = (uri: string) => `[${label}](${uri.replace(/[\\()]/g, "\\$&")})`;
	if (isUrlLike(loc)) return link(loc);
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
	frontmatter: Frontmatter | null,
	docUri?: string,
): string[] {
	return buildSharedHoverLines(
		id,
		kind,
		frontmatter,
		docUri
			? {
					node: (nodeId, icon) =>
						`[${icon} ${nodeId}](command:${GOTO_COMMAND}?${encodeURIComponent(JSON.stringify([docUri, nodeId]))})`,
					location: (loc) => locationLink(docUri, loc, frontmatter?.basePath),
					command: (command) =>
						`${command}  [▶ run](command:${RUN_COMMAND}?${encodeURIComponent(JSON.stringify([command, docUri, frontmatter?.basePath]))})`,
				}
			: undefined,
	);
}
