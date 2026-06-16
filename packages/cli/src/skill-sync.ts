import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolves the directory containing the bundled pfd-ops skill tree
 * (SKILL.md, references/, install/).
 *
 * Production: this file runs from `dist/skill-sync.js`, and the skill tree
 * is bundled as a sibling at `dist/skills/pfd-ops` (see tsup.config.ts
 * onSuccess hook).
 *
 * Source/test execution: this file runs from `packages/cli/src/`, where
 * `dist/skills/pfd-ops` may not exist yet (pre-build). Fall back to the
 * repo's canonical `.claude/skills/pfd-ops`, three levels up from `src/`.
 */
export function resolveSkillRoot(): string {
	const distCandidate = resolve(__dirname, "skills/pfd-ops");
	if (existsSync(distCandidate)) return distCandidate;

	const sourceCandidate = resolve(__dirname, "../../../.claude/skills/pfd-ops");
	if (existsSync(sourceCandidate)) return sourceCandidate;

	throw new Error(
		`pfd-ops skill tree not found at ${distCandidate} or ${sourceCandidate}`,
	);
}
