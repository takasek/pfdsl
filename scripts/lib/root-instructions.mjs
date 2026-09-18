// Renders the repository root instructions document — CLAUDE.md for Claude
// Code, AGENTS.md for Codex — from a single mustache template
// (scripts/root-instructions-template/INSTRUCTIONS.md, #1160). Harness-only
// spans live inline as `{{#claude}}`/`{{#codex}}` sections in one Markdown
// file rather than being carved out of a hand-authored CLAUDE.md by
// re-deriving Markdown structure (heading-level scanning, fence tracking):
// that re-derivation was the defect source this replaces.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Mustache from "mustache";

import {
	addGeneratedMarkdownNotice,
	CODEX_WORKTREE_METADATA_INSTRUCTIONS,
} from "./gen-codex-assets.mjs";
import { findUnresolvedTemplateTokens } from "./template-tokens.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT_INSTRUCTIONS_TEMPLATE_PATH = resolve(
	__dirname,
	"..",
	"root-instructions-template",
	"INSTRUCTIONS.md",
);

const TARGET_VIEWS = {
	claude: { claude: true },
	codex: {
		codex: true,
		codexWorktreeMetadataInstructions:
			CODEX_WORKTREE_METADATA_INSTRUCTIONS.trim(),
	},
};

/**
 * Render a mustache template against an explicit view, then reject a
 * rendered document that still carries a `{{...}}`-shaped token. Mustache
 * itself never leaves an unresolved *tag* behind (an unknown variable
 * interpolates to the empty string rather than its own name); what this
 * guards is literal template-like text arriving through an interpolated
 * value — e.g. `{{{codexWorktreeMetadataInstructions}}}` reproducing a
 * mustache example verbatim inside its own prose — which mustache does not
 * and cannot re-scan.
 * @param {{template: string, view: object}} options
 * @returns {string}
 */
export function renderTemplate({ template, view }) {
	const rendered = Mustache.render(template, view);
	const unresolved = findUnresolvedTemplateTokens(rendered);
	if (unresolved.length > 0) {
		throw new Error(
			`root-instructions: unresolved template token ${unresolved[0]}.`,
		);
	}
	return rendered;
}

// What the retired `claudeInstructionsToAgents()` substitution rewrote on this
// path, stated as a refusal instead. Rewriting was context-free, so it also
// changed prose that was *about* the relationship between the two files
// ("CLAUDE.md と AGENTS.md は自動生成の関係にある" became "AGENTS.md と
// AGENTS.md は…"); refusing leaves the author's words alone and tells them
// where the line belongs. Only paths are listed — a harness *name* is
// legitimately shared prose, as in the setup section naming both harnesses'
// SessionStart hook.
const FOREIGN_PATH_LITERALS = {
	claude: { harness: "Codex", literals: ["AGENTS.md", ".agents/", ".codex/"] },
	codex: {
		harness: "Claude",
		literals: ["CLAUDE.md", ".claude/", "CLAUDE_PLUGIN_ROOT"],
	},
};

/**
 * Refuse a rendered document that names a path belonging to the other harness.
 * Operates on the rendered output, not the template, so it needs no notion of
 * which region of the template is shared — a literal inside a harness-only
 * section never reaches the other harness's output and so is never flagged.
 * @param {{rendered: string, target: "claude" | "codex"}} options
 */
function assertNoForeignPathLiterals({ rendered, target }) {
	const { harness, literals } = FOREIGN_PATH_LITERALS[target];
	for (const literal of literals) {
		if (!rendered.includes(literal)) continue;
		throw new Error(
			`root-instructions: ${target} output contains the ${harness}-only literal ${JSON.stringify(literal)}. ` +
				`Move that line inside a {{#claude}} or {{#codex}} section, or render the path from a per-harness value.`,
		);
	}
}

/**
 * Render the shared root-instructions template body for one harness target.
 * Every variable reference in the template must be non-escaping
 * (`{{{var}}}` or `{{&var}}`): the output is Markdown, and mustache's default
 * `{{var}}` HTML-escapes characters like `` ` `` that are meaningful there.
 * @param {{template: string, target: "claude" | "codex"}} options
 * @returns {string}
 */
export function renderRootInstructionsBody({ template, target }) {
	const view = TARGET_VIEWS[target];
	if (!view) {
		throw new Error(`root-instructions: unsupported target ${target}.`);
	}
	const rendered = renderTemplate({ template, view });
	assertNoForeignPathLiterals({ rendered, target });
	return rendered;
}

/**
 * Render CLAUDE.md or AGENTS.md complete with its DO NOT EDIT notice.
 * @param {{template: string, target: "claude" | "codex", authoritativeSource: string}} options
 * @returns {string}
 */
export function renderRootInstructions({
	template,
	target,
	authoritativeSource,
}) {
	const body = renderRootInstructionsBody({ template, target });
	return addGeneratedMarkdownNotice(body, authoritativeSource);
}
