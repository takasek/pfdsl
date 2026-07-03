import type { Diagnostic } from "./diagnostic.js";

export const STATUS_VALUES = [
	"done",
	"wip",
	"todo",
	"waiting",
	"suspended",
] as const;
export type Status = (typeof STATUS_VALUES)[number];

export const STYLE_ATTRS = [
	"fillcolor",
	"color",
	"fontcolor",
	"style",
	"penwidth",
] as const;
export type StyleAttr = (typeof STYLE_ATTRS)[number];
export type NodeStyle = Partial<Record<StyleAttr, string>>;

export interface ArtifactMeta {
	label?: string;
	description?: string;
	owner?: string;
	externalStakeholders?: string[];
	parts?: string[];
	/** Optional positive-integer node index (pfd-tools D{index}). Namespace independent from processes. */
	index?: number;
	status?: Status;
	tags?: string[];
	group?: string;
	criteria?: string;
	location?: string | string[];
	revises?: string;
	[key: string]: unknown;
}

export interface ProcessMeta {
	label?: string;
	description?: string;
	owner?: string;
	externalStakeholders?: string[];
	/** Optional positive-integer node index (pfd-tools P{index}). Namespace independent from artifacts. */
	index?: number;
	group?: string;
	tags?: string[];
	command?: string;
	/** Relative path to a child .pfdsl expanded as a subflow view-link (§2.9.3). */
	subflow?: string;
	/** Optional 1:1 boundary rename map (parent id → child id) for a subflow (§2.9.3). */
	boundary?: Record<string, string>;
	[key: string]: unknown;
}

export interface GroupMeta {
	label?: string;
	color?: string;
	parent?: string;
	[key: string]: unknown;
}

export interface TagMeta {
	label?: string;
	description?: string;
	style?: NodeStyle;
	[key: string]: unknown;
}

export interface Frontmatter {
	title?: string;
	version?: string | number;
	dslVersion?: string;
	description?: string;
	tags?: string[];
	layout?: {
		direction?: "LR" | "RL" | "TB" | "BT";
		maxWidth?: number;
		[key: string]: unknown;
	};
	artifact?: Record<string, ArtifactMeta>;
	process?: Record<string, ProcessMeta>;
	group?: Record<string, GroupMeta>;
	tag?: Record<string, TagMeta>;
	statusStyles?: Partial<Record<Status, NodeStyle>>;
	/** Relative path(s) to preset file(s) inherited for presentation keys (§2.9.4). */
	extends?: string | string[];
	/** Relative path from the .pfdsl file used as base for location: and command: resolution. Default: .pfdsl file's directory. */
	basePath?: string;
	[key: string]: unknown;
}

export interface LoadResult {
	frontmatter: Frontmatter | null;
	body: string;
	bodyStartLine: number; // 1-based line where body starts
	diagnostics: Diagnostic[];
}
