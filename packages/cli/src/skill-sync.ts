import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

/**
 * Copies the general layer (SKILL.md + references/*) from the bundled skill
 * root into `<targetRoot>/.claude/skills/pfd-ops/`, unconditionally
 * overwriting. The install/ subtree is excluded — its copy is conditional
 * on L3 adoption (handled in a later task).
 */
export function copyGeneralLayer(skillRoot: string, targetRoot: string): void {
	const dest = join(targetRoot, ".claude/skills/pfd-ops");
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(skillRoot)) {
		if (entry === "install") continue;
		cpSync(join(skillRoot, entry), join(dest, entry), { recursive: true });
	}
}
