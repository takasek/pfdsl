import { isUrlLike } from "../multifile.js";
import { zeroRange } from "../position.js";
import { referenceTargetSchema } from "../types/frontmatter.js";
import type { Diagnostic, Range } from "../types/index.js";
import type { RuleContext } from "./context.js";

/** V037–V039: declarations can be checked without fetching their targets (§15.18). */
export function referenceDeclarations(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const checkTarget = (target: unknown, field: string, range: Range) => {
		if (
			target !== undefined &&
			!referenceTargetSchema.safeParse(target).success
		) {
			diagnostics.push({
				severity: "error",
				code: "V037",
				message: `'${field}' requires non-blank 'source' and 'revision' strings and no additional members`,
				range,
			});
		}
	};
	checkTarget(ctx.fm?.baseRef, "baseRef", zeroRange());
	for (const [id, meta] of Object.entries(ctx.artifactMeta)) {
		checkTarget(meta.ref, `artifact.${id}.ref`, ctx.rangeOf(id));
		if (meta.ref === undefined && ctx.fm?.baseRef === undefined) continue;
		const locations = Array.isArray(meta.location)
			? meta.location
			: meta.location === undefined
				? []
				: [meta.location];
		for (const location of locations) {
			// Recognize authored POSIX and Windows absolute paths on every host.
			if (!isUrlLike(location) && /^(?:[\\/]|[A-Za-z]:[\\/])/.test(location)) {
				diagnostics.push({
					severity: "error",
					code: "V039",
					message: `Artifact '${id}' has an explicit reference target and absolute location '${location}'; use a path within the selected resource collection`,
					range: ctx.rangeOf(id),
				});
			}
		}
	}
	for (const [id, meta] of Object.entries(ctx.processMeta)) {
		if (meta.ref !== undefined) {
			diagnostics.push({
				severity: "error",
				code: "V038",
				message: `'ref' is not allowed on process '${id}'`,
				range: ctx.rangeOf(id),
			});
		}
	}
	return diagnostics;
}
