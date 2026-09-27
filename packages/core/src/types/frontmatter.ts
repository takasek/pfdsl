import * as z from "zod/mini";
import type { Diagnostic } from "./diagnostic.js";

export const STATUS_VALUES = [
	"done",
	"wip",
	"todo",
	"waiting",
	"suspended",
] as const;
export type Status = (typeof STATUS_VALUES)[number];

export const PFD_TYPE_VALUES = ["roadmap", "workflow", "pipeline"] as const;
export type PfdType = (typeof PFD_TYPE_VALUES)[number];

/**
 * Whether a file is a roadmap as far as the roadmap-only operations are
 * concerned (§15.14): an omitted `type:` reads as roadmap, so only an explicit
 * other kind is excluded. Callers ask this rather than restating the condition,
 * so they cannot drift apart on what "roadmap" means.
 */
export function isRoadmapType(type: PfdType | undefined): boolean {
	return type === undefined || type === "roadmap";
}

export const STYLE_ATTRS = [
	"fillcolor",
	"color",
	"fontcolor",
	"style",
	"penwidth",
] as const;
export type StyleAttr = (typeof STYLE_ATTRS)[number];
const text = z.optional(z.string());
const styleFields = Object.fromEntries(
	STYLE_ATTRS.map((key) => [key, text]),
) as Record<StyleAttr, typeof text>;
export const nodeStyleSchema = z.strictObject(styleFields);
const styleInputSchema = z.looseObject(styleFields);
export const nodeIndexSchema = z.number().check(z.gte(1), z.multipleOf(1));
const strings = z.array(z.string());
const paths = z.union([z.string(), strings]);
const common = {
	label: text,
	description: text,
	owner: text,
	externalStakeholders: z.optional(strings),
	index: z.optional(z.number()),
	tags: z.optional(strings),
	group: text,
	location: z.optional(paths),
};
export const artifactMetaSchema = z.looseObject({
	...common,
	parts: z.optional(strings),
	status: z.optional(z.enum(STATUS_VALUES)),
	criteria: text,
	revises: text,
});
export const processMetaSchema = z.looseObject({
	...common,
	command: text,
	subflow: text,
	boundary: z.optional(z.record(z.string(), z.string())),
});
export const groupMetaSchema = z.looseObject({
	label: text,
	color: text,
	parent: text,
});
export const tagMetaSchema = z.looseObject({
	label: text,
	description: text,
	style: z.optional(nodeStyleSchema),
});
export const frontmatterSchema = z.looseObject({
	title: text,
	version: z.optional(z.union([z.string(), z.number()])),
	dslVersion: text,
	description: text,
	tags: z.optional(strings),
	layout: z.optional(
		z.looseObject({
			direction: z.optional(z.enum(["LR", "RL", "TB", "BT"])),
			maxWidth: z.optional(z.number()),
		}),
	),
	artifact: z.optional(z.record(z.string(), artifactMetaSchema)),
	process: z.optional(z.record(z.string(), processMetaSchema)),
	group: z.optional(z.record(z.string(), groupMetaSchema)),
	tag: z.optional(z.record(z.string(), tagMetaSchema)),
	statusStyles: z.optional(
		z.partialRecord(z.enum(STATUS_VALUES), nodeStyleSchema),
	),
	extends: z.optional(paths),
	basePath: text,
	type: z.optional(z.enum(PFD_TYPE_VALUES)),
});
/** Shape validation precedes semantic rules. Keep string-valued enum errors
 * and unknown style keys readable so V007/V008/V009/V031 and meta set repair
 * retain their existing behavior. Allowed values still come from the constants
 * above. Empty YAML declarations are normalized to {} after checking. */
export const frontmatterInputSchema = z.extend(frontmatterSchema, {
	artifact: z.optional(
		z.record(
			z.string(),
			z.nullable(z.extend(artifactMetaSchema, { status: text })),
		),
	),
	process: z.optional(z.record(z.string(), z.nullable(processMetaSchema))),
	group: z.optional(z.record(z.string(), z.nullable(groupMetaSchema))),
	tag: z.optional(
		z.record(
			z.string(),
			z.nullable(
				z.extend(tagMetaSchema, { style: z.optional(styleInputSchema) }),
			),
		),
	),
	statusStyles: z.optional(z.record(z.string(), styleInputSchema)),
	type: text,
});
/** Match exactOptionalPropertyTypes: omission, not an explicit undefined value. */
type DefinedOptionals<T> = T extends object
	? { [K in keyof T]: DefinedOptionals<Exclude<T[K], undefined>> }
	: T;
export type NodeStyle = DefinedOptionals<z.infer<typeof nodeStyleSchema>>;
export type ArtifactMeta = DefinedOptionals<z.infer<typeof artifactMetaSchema>>;
export type ProcessMeta = DefinedOptionals<z.infer<typeof processMetaSchema>>;
export type GroupMeta = DefinedOptionals<z.infer<typeof groupMetaSchema>>;
export type TagMeta = DefinedOptionals<z.infer<typeof tagMetaSchema>>;
export type Frontmatter = DefinedOptionals<z.infer<typeof frontmatterSchema>>;

export interface LoadResult {
	frontmatter: Frontmatter | null;
	body: string;
	bodyStartLine: number; // 1-based line where body starts
	diagnostics: Diagnostic[];
}
