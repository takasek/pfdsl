/** Build-time conversion only: do not import this module from the runtime entry. */
import * as z from "zod/mini";
import {
	artifactMetaSchema,
	frontmatterSchema,
	groupMetaSchema,
	nodeIndexSchema,
	processMetaSchema,
	tagMetaSchema,
} from "./types/frontmatter.js";

// Describe authored YAML, not the permissive loader gate or normalized values.
// Cross-node references, cycles and uniqueness remain the semantic validator's job.
const documentSchema = z.extend(frontmatterSchema, {
	artifact: z.optional(
		z.record(
			z.string(),
			z.nullable(
				z.extend(artifactMetaSchema, { index: z.optional(nodeIndexSchema) }),
			),
		),
	),
	process: z.optional(
		z.record(
			z.string(),
			z.nullable(
				z.extend(processMetaSchema, { index: z.optional(nodeIndexSchema) }),
			),
		),
	),
	group: z.optional(z.record(z.string(), z.nullable(groupMetaSchema))),
	tag: z.optional(z.record(z.string(), z.nullable(tagMetaSchema))),
});
export const FRONTMATTER_JSON_SCHEMA = {
	...z.toJSONSchema(documentSchema, { target: "draft-2020-12" }),
	title: "PFDSL frontmatter",
	description:
		"Validates non-empty frontmatter mappings. Graph references, cycles, field placement and cross-node constraints require pfdsl check. This schema does not validate the DSL body.",
};
