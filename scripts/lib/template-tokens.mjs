// Residual `{{...}}` detection, shared by the two template-rendered outputs:
// the distributed SKILL.md (scripts/gen-skill.mjs, plain `.replace()`) and the
// repository root instructions (scripts/lib/root-instructions.mjs, mustache).
//
// The two renderers leave residue for different reasons — a `.replace()` the
// author forgot to add, versus a raw mustache value whose own prose contains
// template syntax that mustache does not re-scan — but the residue looks the
// same and ships to readers the same way, so the detection lives once.

const TEMPLATE_TOKEN = /\{\{[^{}]*\}\}/g;

/**
 * @param {string} rendered a fully rendered document
 * @returns {string[]} each distinct residual token, in first-seen order
 */
export function findUnresolvedTemplateTokens(rendered) {
	return [...new Set(rendered.match(TEMPLATE_TOKEN) ?? [])];
}
