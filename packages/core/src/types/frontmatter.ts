import type { Diagnostic } from "./diagnostic.js";

export const STATUS_VALUES = ["done", "wip", "todo", "blocked"] as const;
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

/** Estimation parameters for pfd-tools interop (§2.3, #220). Process variant. */
export interface ProcessSchedule {
	/** Est. Work Volume（抽象作業量、非負数）. */
	workVolume?: number;
	/** Est. Rework Volume Ratio（0.0–1.0）. */
	reworkRatio?: number;
	/** Needed Resources（pfd-tools と同形式の文字列）. */
	resources?: string;
	/** Start Condition（pfd-tools と同 DSL の文字列）. */
	startCondition?: string;
	/** Milestone ID. */
	milestone?: string;
	[key: string]: unknown;
}

/** Estimation parameters for pfd-tools interop (§2.3, #220). Artifact variant. */
export interface ArtifactSchedule {
	/** 外部入力成果物の利用可能開始時刻（非負数）. */
	availableTime?: number;
	/** feedback ループの終了条件（非負整数）. */
	maxRevision?: number;
	[key: string]: unknown;
}

export const PROCESS_SCHEDULE_KEYS = [
	"workVolume",
	"reworkRatio",
	"resources",
	"startCondition",
	"milestone",
] as const;
export const ARTIFACT_SCHEDULE_KEYS = ["availableTime", "maxRevision"] as const;

export interface ArtifactMeta {
	label?: string;
	description?: string;
	owner?: string;
	externalStakeholders?: string[];
	parts?: string[];
	status?: Status;
	tags?: string[];
	group?: string;
	criteria?: string;
	location?: string | string[];
	revises?: string;
	/** Estimation parameters for pfd-tools interop (§2.3, #220). */
	schedule?: ArtifactSchedule;
	[key: string]: unknown;
}

export interface ProcessMeta {
	label?: string;
	description?: string;
	owner?: string;
	externalStakeholders?: string[];
	group?: string;
	tags?: string[];
	command?: string;
	/** Relative path to a child .pfdsl expanded as a subflow view-link (§2.9.3). */
	subflow?: string;
	/** Optional 1:1 boundary rename map (parent id → child id) for a subflow (§2.9.3). */
	boundary?: Record<string, string>;
	/** Estimation parameters for pfd-tools interop (§2.3, #220). */
	schedule?: ProcessSchedule;
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
	[key: string]: unknown;
}

export interface LoadResult {
	frontmatter: Frontmatter | null;
	body: string;
	bodyStartLine: number; // 1-based line where body starts
	diagnostics: Diagnostic[];
}
