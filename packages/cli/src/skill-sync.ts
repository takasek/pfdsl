import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolves the directory containing a bundled skill tree (SKILL.md, etc.).
 *
 * Production: this file runs from `dist/skill-sync.js`, and skill trees
 * are bundled as siblings at `dist/skills/<name>` (see tsup.config.ts
 * onSuccess hook).
 *
 * Source/test execution: this file runs from `packages/cli/src/`, where
 * `dist/skills/<name>` may not exist yet (pre-build). Fall back to the
 * repo's canonical `.claude/skills/<name>`, three levels up from `src/`.
 */
export function resolveSkillRoot(name: string): string {
	const distCandidate = resolve(__dirname, `skills/${name}`);
	if (existsSync(distCandidate)) return distCandidate;

	const sourceCandidate = resolve(__dirname, `../../../.claude/skills/${name}`);
	if (existsSync(sourceCandidate)) return sourceCandidate;

	throw new Error(
		`${name} skill tree not found at ${distCandidate} or ${sourceCandidate}`,
	);
}

/**
 * Resolves the directory containing the bundled commands (pfd-cycle.md, etc.).
 * Production: `dist/commands/`. Source/test: `.claude/commands/` three levels up.
 */
export function resolveCommandsDir(): string {
	const distCandidate = resolve(__dirname, "commands");
	if (existsSync(distCandidate)) return distCandidate;

	const sourceCandidate = resolve(__dirname, "../../../.claude/commands");
	if (existsSync(sourceCandidate)) return sourceCandidate;

	throw new Error(
		`commands dir not found at ${distCandidate} or ${sourceCandidate}`,
	);
}

/**
 * Commands are opt-in for distribution: only files matching this pattern
 * leak into the npm package and adopting repos. Repo-local commands
 * (debugging helpers, maintainer-only workflows) stay out by default.
 */
const DISTRIBUTABLE_COMMAND_PATTERN = /^pfd-.*\.md$/;

export function isDistributableCommand(filename: string): boolean {
	return DISTRIBUTABLE_COMMAND_PATTERN.test(filename);
}

/**
 * Copies allowlisted command files into `<targetRoot>/.claude/commands/`,
 * overwriting existing files so stale entries don't linger.
 */
export function copyCommands(commandsDir: string, targetRoot: string): void {
	const dest = join(targetRoot, ".claude/commands");
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(commandsDir)) {
		if (!isDistributableCommand(entry)) continue;
		cpSync(join(commandsDir, entry), join(dest, entry));
	}
}

/**
 * Mirrors the whole bundled skill tree (SKILL.md + references/ + install/
 * templates) into `<targetRoot>/.claude/skills/pfd-ops/`, unconditionally:
 * each entry's existing destination is removed first, so files deleted/renamed
 * upstream don't linger in the adopter.
 *
 * install/ is included so a fresh adopter has the canonical templates on disk
 * and can run `cp -r .claude/skills/pfd-ops/install/. .` to adopt L3.
 * Deploying install/ to the repo root is a separate, adoption-gated step
 * (see copyInstallLayer).
 */
export function copySkillTree(skillRoot: string, targetRoot: string): void {
	const dest = join(targetRoot, ".claude/skills", basename(skillRoot));
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(skillRoot)) {
		rmSync(join(dest, entry), { recursive: true, force: true });
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
				"  cp -r .claude/skills/pfd-ops/install/. .\n" +
				"L3 の意味は .claude/skills/pfd-ops/references/architecture.md を参照してください。\n",
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

/**
 * Returns guidance to run /pfd-ecosystem when .pfdsl/ contains no .pfdsl
 * files yet. Templates for all three kinds (roadmap / workflow /
 * runtime-pipeline) are available in the synced skill tree under
 * .claude/skills/pfd-ops/references/scaffold/ — the user copies only the
 * kinds their project needs via /pfd-ecosystem.
 * Returns "" when .pfdsl/ already has at least one .pfdsl file.
 */
export function pfdslDirGuidance(targetRoot: string): string {
	const pfdslDir = join(targetRoot, ".pfdsl");
	const hasAnyPfdsl =
		existsSync(pfdslDir) &&
		readdirSync(pfdslDir).some((f) => f.endsWith(".pfdsl"));
	if (hasAnyPfdsl) return "";
	return (
		".pfdsl/ にファイルがありません。`/pfd-ecosystem` スキルを起動して\n" +
		"プロジェクトに必要な種別（roadmap / workflow / runtime-pipeline）の\n" +
		"テンプレートを .claude/skills/pfd-ops/references/scaffold/ からコピーしてください。\n"
	);
}

const REQUIRED_LABELS = ["flow:managed", "flow:exempt"] as const;

export type ExecGh = (args: string[]) => string;

function defaultExecGh(args: string[]): string {
	return execFileSync("gh", args, { encoding: "utf-8" });
}

async function defaultConfirm(question: string): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question(question);
		return answer.trim().toLowerCase() === "y";
	} finally {
		rl.close();
	}
}

export interface EnsureLabelsOptions {
	yes: boolean;
	execGh?: ExecGh;
	confirm?: (question: string) => Promise<boolean>;
}

export interface EnsureLabelsResult {
	created: string[];
	message: string;
}

/**
 * Ensures flow:managed / flow:exempt labels exist via gh. Subordinate to L3
 * adoption — callers should only invoke this when isL3Adopted() is true.
 * gh missing -> guidance message, not an error. gh present -> list missing
 * labels and confirm [y/N] (auto-yes with --yes).
 */
export async function ensureLabels(
	opts: EnsureLabelsOptions,
): Promise<EnsureLabelsResult> {
	const execGh = opts.execGh ?? defaultExecGh;
	const confirm = opts.confirm ?? defaultConfirm;

	let existing: string;
	try {
		existing = execGh(["label", "list"]);
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
			return {
				created: [],
				message:
					"gh コマンドが見つかりません。flow:managed / flow:exempt ラベルは手動作成してください。\n",
			};
		}
		const reason = err instanceof Error ? err.message : String(err);
		return {
			created: [],
			message: `gh ラベル確認に失敗しました（${reason}）。flow:managed / flow:exempt ラベルは手動で確認してください。\n`,
		};
	}

	const names = new Set(
		existing
			.split("\n")
			.filter((line) => line.trim() !== "")
			.map((line) => line.split("\t")[0]!.trim()),
	);
	const missing = REQUIRED_LABELS.filter((label) => !names.has(label));
	if (missing.length === 0) {
		return { created: [], message: "" };
	}

	if (!opts.yes) {
		const proceed = await confirm(
			`不足しているラベルを作成しますか: ${missing.join(", ")} [y/N] `,
		);
		if (!proceed) return { created: [], message: "" };
	}

	for (const label of missing) {
		execGh(["label", "create", label]);
	}
	return { created: [...missing], message: "" };
}

export interface RunSkillSyncOptions {
	targetRoot: string;
	yes: boolean;
	execGh?: ExecGh;
	confirm?: (question: string) => Promise<boolean>;
}

export interface SkillSyncResult {
	stdout: string;
	exitCode: number;
}

/**
 * Orchestrates the full `pfdsl skill sync pfd-ops` flow:
 * general layer overwrite -> conditional install/ overwrite (subordinate gh
 * label confirmation when adopted) -> L4 scaffold -> ecosystem-setup prompt
 * -> pfdsl skill guidance when absent.
 */
export async function runSkillSync(
	opts: RunSkillSyncOptions,
): Promise<SkillSyncResult> {
	const skillRoot = resolveSkillRoot("pfd-ops");
	const lines: string[] = [];

	copySkillTree(skillRoot, opts.targetRoot);
	lines.push("pfd-ops skill tree synced (.claude/skills/pfd-ops/).");

	copySkillTree(resolveSkillRoot("pfd-retro"), opts.targetRoot);
	lines.push("pfd-retro skill tree synced (.claude/skills/pfd-retro/).");

	copySkillTree(resolveSkillRoot("pfd-ecosystem"), opts.targetRoot);
	lines.push(
		"pfd-ecosystem skill tree synced (.claude/skills/pfd-ecosystem/).",
	);

	copySkillTree(resolveSkillRoot("pfdsl"), opts.targetRoot);
	lines.push("pfdsl skill tree synced (.claude/skills/pfdsl/).");

	copyCommands(resolveCommandsDir(), opts.targetRoot);
	lines.push("commands synced (.claude/commands/).");

	const installResult = copyInstallLayer(skillRoot, opts.targetRoot);
	if (installResult.copied) {
		lines.push("pfd-ops install/ layer synced (L3 adopted).");
		const labelResult = await ensureLabels({
			yes: opts.yes,
			...(opts.execGh ? { execGh: opts.execGh } : {}),
			...(opts.confirm ? { confirm: opts.confirm } : {}),
		});
		if (labelResult.message) lines.push(labelResult.message);
		if (labelResult.created.length > 0) {
			lines.push(`Created labels: ${labelResult.created.join(", ")}`);
		}
	} else {
		lines.push(installResult.message);
	}

	const dirGuidance = pfdslDirGuidance(opts.targetRoot);
	if (dirGuidance) lines.push(dirGuidance);

	lines.push(
		"Tip: `npx @pfdsl/cli@latest` re-installs on every run. " +
			"For faster checks, install once:\n" +
			"  npm install -g @pfdsl/cli          # global\n" +
			"  npm install --save-dev @pfdsl/cli  # or as a devDependency",
	);

	return { stdout: `${lines.join("\n")}\n`, exitCode: 0 };
}
