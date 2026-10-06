import type { DiffReport } from "@pfdsl/core";
import type { PreviewEditRequest } from "./preview-edit.js";
import type { PreviewGraph } from "./preview-graph.js";

/**
 * Shared postMessage protocol between preview.ts (extension host) and
 * webview.ts (webview script). Previously hand-rolled separately in both
 * files — the webview's copy of the "diff" variant's report shape drifted
 * from DiffReport and silently dropped `changedNodes`, which meant the
 * `~ node` rows the CLI prints never reached the panel (#426).
 */
export type MessageToWebview =
	| {
			type: "render";
			dot: string;
			focusNodeId?: string;
			descriptions?: Record<string, Array<[string, string]>>;
			locations?: Record<string, string[]>;
			subflows?: Record<string, string>;
			graph?: PreviewGraph;
			editing?: {
				source: string;
				nodes: Array<{
					id: string;
					kind: "artifact" | "process";
					defined: boolean;
				}>;
			};
	  }
	| { type: "error"; message: string }
	| { type: "focus"; nodeId: string }
	| { type: "clearFocus" }
	| { type: "diff"; report: DiffReport }
	| { type: "clearDiff" };

export type MessageFromWebview =
	| PreviewEditRequest
	| { type: "ready" }
	| { type: "nodeClick"; nodeId: string }
	| { type: "openUrl"; url: string }
	| { type: "openFile"; path: string }
	| { type: "openLocation"; nodeId: string };
