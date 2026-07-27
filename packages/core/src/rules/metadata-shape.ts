import { zeroRange } from "../position.js";
import type { Diagnostic } from "../types/index.js";
import { STATUS_VALUES, STYLE_ATTRS } from "../types/index.js";
import type { RuleContext } from "./context.js";

const STATUS_SET: ReadonlySet<string> = new Set(STATUS_VALUES);
const STYLE_ATTR_SET: ReadonlySet<string> = new Set(STYLE_ATTRS);

/**
 * V029 / W004: `index:` must be a positive integer, and must be unique within
 * its namespace (§15.13). Artifacts and processes are numbered independently,
 * so the same index on one of each is fine.
 */
export function indexShape(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	const check = (
		entries: Record<string, { index?: unknown }>,
		kind: "artifact" | "process",
	): void => {
		const seen = new Map<number, string>();
		for (const [id, meta] of Object.entries(entries)) {
			const idx = meta?.index;
			if (idx === undefined) continue;
			if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 1) {
				diagnostics.push({
					severity: "error",
					code: "V029",
					message: `Invalid index '${String(idx)}' on ${kind} '${id}'. Must be a positive integer`,
					range: ctx.rangeOf(id),
				});
				continue;
			}
			const prev = seen.get(idx);
			if (prev !== undefined) {
				diagnostics.push({
					severity: "warning",
					code: "W004",
					message: `Duplicate index ${idx} on ${kind} '${id}' (also on '${prev}')`,
					range: ctx.rangeOf(id),
				});
			} else {
				seen.set(idx, id);
			}
		}
	};

	check(ctx.artifactMeta, "artifact");
	check(ctx.processMeta, "process");
	return diagnostics;
}

/**
 * V008 / V009: `statusStyles:` may only be keyed by a status, and both it and
 * `tag.<id>.style` may only carry known attributes (§15.6).
 */
export function styleShape(ctx: RuleContext): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const [key, style] of Object.entries(ctx.fm?.statusStyles ?? {})) {
		if (!STATUS_SET.has(key)) {
			diagnostics.push({
				severity: "error",
				code: "V008",
				message: `Invalid statusStyles key '${key}'. Allowed: ${STATUS_VALUES.join(", ")}`,
				range: zeroRange(),
			});
		}
		for (const attr of Object.keys(style ?? {})) {
			if (!STYLE_ATTR_SET.has(attr)) {
				diagnostics.push({
					severity: "error",
					code: "V009",
					message: `Invalid style attribute '${attr}' in statusStyles.${key}. Allowed: ${STYLE_ATTRS.join(", ")}`,
					range: zeroRange(),
				});
			}
		}
	}
	for (const [key, meta] of Object.entries(ctx.fm?.tag ?? {})) {
		for (const attr of Object.keys(meta?.style ?? {})) {
			if (!STYLE_ATTR_SET.has(attr)) {
				diagnostics.push({
					severity: "error",
					code: "V009",
					message: `Invalid style attribute '${attr}' in tag.${key}.style. Allowed: ${STYLE_ATTRS.join(", ")}`,
					range: zeroRange(),
				});
			}
		}
	}
	return diagnostics;
}
