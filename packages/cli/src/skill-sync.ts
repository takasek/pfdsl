import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

/**
 * Recursively lists all file paths under `dir`, relative to `dir`,
 * using forward-slash separators (matches install/ tree's repo-root-relative
 * layout, e.g. ".github/workflows/check-pfd-ops-sync.yml").
 */
function listFilesRecursive(dir: string, prefix = ""): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const abs = join(dir, entry);
		const rel = prefix ? `${prefix}/${entry}` : entry;
		if (statSync(abs).isDirectory()) {
			out.push(...listFilesRecursive(abs, rel));
		} else {
			out.push(rel);
		}
	}
	return out;
}

/**
 * Returns the list of relative paths that install/ deploys to repo root,
 * derived dynamically from the bundled install/ tree (not hardcoded).
 */
export function listInstallFiles(skillRoot: string): string[] {
	const installDir = join(skillRoot, "install");
	if (!existsSync(installDir)) return [];
	return listFilesRecursive(installDir);
}

/**
 * L3 (GitHub Issues backend / install/ mechanism) is considered adopted if
 * any install/-derived file already exists at the target repo root.
 * Adoption is all-or-nothing (cp -r install/. .), so a single hit is enough.
 */
export function isL3Adopted(skillRoot: string, targetRoot: string): boolean {
	return listInstallFiles(skillRoot).some((rel) =>
		existsSync(join(targetRoot, rel)),
	);
}

export interface InstallCopyResult {
	copied: boolean;
	message: string;
}

/**
 * Copies install/ (L3 mechanism: workflows, audit scripts) to target root,
 * preserving relative paths, but only when L3 is already adopted there.
 * When not adopted, copies nothing and returns guidance for first-time
 * adoption (out of scope for sync itself).
 */
export function copyInstallLayer(
	skillRoot: string,
	targetRoot: string,
): InstallCopyResult {
	if (!isL3Adopted(skillRoot, targetRoot)) {
		return {
			copied: false,
			message:
				"GitHub Issues バックエンド (L3) は未採用です。採用する場合は次を実行してください:\n" +
				"  cp -r .claude/skills/pfd-ops/install/. .\n",
		};
	}
	const installDir = join(skillRoot, "install");
	for (const rel of listInstallFiles(skillRoot)) {
		const src = join(installDir, rel);
		const dest = join(targetRoot, rel);
		mkdirSync(dirname(dest), { recursive: true });
		cpSync(src, dest);
	}
	return { copied: true, message: "" };
}
