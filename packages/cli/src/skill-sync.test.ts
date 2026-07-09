import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	copyAgents,
	copyCommands,
	copyInstallLayer,
	copySkillTree,
	ensureLabels,
	isL3Adopted,
	pfdslDirGuidance,
	resolveAgentsDir,
	resolveCommandsDir,
	resolveSkillRoot,
	runSkillSync,
} from "./skill-sync.js";

describe("resolveCommandsDir", () => {
	it("resolves to a directory containing pfd-cycle.md", () => {
		const dir = resolveCommandsDir();
		expect(existsSync(join(dir, "pfd-cycle.md"))).toBe(true);
	});
});

describe("resolveAgentsDir", () => {
	it("resolves to a directory containing pfd-lens.md", () => {
		const dir = resolveAgentsDir();
		expect(existsSync(join(dir, "pfd-lens.md"))).toBe(true);
	});
});

describe("copyAgents", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("copies pfd-lens.md into .claude/agents/", () => {
		const agentsDir = resolveAgentsDir();
		copyAgents(agentsDir, targetRoot);
		expect(existsSync(join(targetRoot, ".claude/agents/pfd-lens.md"))).toBe(
			true,
		);
	});

	it("overwrites stale agent files", () => {
		const agentsDir = resolveAgentsDir();
		mkdirSync(join(targetRoot, ".claude/agents"), { recursive: true });
		writeFileSync(join(targetRoot, ".claude/agents/pfd-lens.md"), "old\n");
		copyAgents(agentsDir, targetRoot);
		const content = readFileSync(
			join(targetRoot, ".claude/agents/pfd-lens.md"),
			"utf-8",
		);
		expect(content).not.toBe("old\n");
	});

	it("does not copy non pfd-* files, even when present in the source dir", () => {
		const agentsDir = mkdtempSync(join(tmpdir(), "pfdsl-sync-agents-src-"));
		try {
			writeFileSync(join(agentsDir, "pfd-lens.md"), "lens\n");
			writeFileSync(join(agentsDir, "internal-debug.md"), "secret\n");
			copyAgents(agentsDir, targetRoot);
			expect(existsSync(join(targetRoot, ".claude/agents/pfd-lens.md"))).toBe(
				true,
			);
			expect(
				existsSync(join(targetRoot, ".claude/agents/internal-debug.md")),
			).toBe(false);
		} finally {
			rmSync(agentsDir, { recursive: true, force: true });
		}
	});
});

describe("copyCommands", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("copies pfd-init.md, pfd-cycle.md and pfd-retro.md into .claude/commands/", () => {
		const commandsDir = resolveCommandsDir();
		copyCommands(commandsDir, targetRoot);
		expect(existsSync(join(targetRoot, ".claude/commands/pfd-init.md"))).toBe(
			true,
		);
		expect(existsSync(join(targetRoot, ".claude/commands/pfd-cycle.md"))).toBe(
			true,
		);
		expect(existsSync(join(targetRoot, ".claude/commands/pfd-retro.md"))).toBe(
			true,
		);
	});

	it("overwrites stale command files", () => {
		const commandsDir = resolveCommandsDir();
		mkdirSync(join(targetRoot, ".claude/commands"), { recursive: true });
		writeFileSync(join(targetRoot, ".claude/commands/pfd-cycle.md"), "old\n");
		copyCommands(commandsDir, targetRoot);
		const content = readFileSync(
			join(targetRoot, ".claude/commands/pfd-cycle.md"),
			"utf-8",
		);
		expect(content).not.toBe("old\n");
	});

	it("does not copy non pfd-* files, even when present in the source dir", () => {
		const commandsDir = mkdtempSync(join(tmpdir(), "pfdsl-sync-src-"));
		try {
			writeFileSync(join(commandsDir, "pfd-cycle.md"), "cycle\n");
			writeFileSync(join(commandsDir, "internal-debug.md"), "secret\n");
			copyCommands(commandsDir, targetRoot);
			expect(
				existsSync(join(targetRoot, ".claude/commands/pfd-cycle.md")),
			).toBe(true);
			expect(
				existsSync(join(targetRoot, ".claude/commands/internal-debug.md")),
			).toBe(false);
		} finally {
			rmSync(commandsDir, { recursive: true, force: true });
		}
	});
});

describe("resolveSkillRoot", () => {
	it("resolves pfd-ops to a directory containing SKILL.md", () => {
		const root = resolveSkillRoot("pfd-ops");
		expect(existsSync(`${root}/SKILL.md`)).toBe(true);
	});

	it("resolves pfd-retro to a directory containing SKILL.md", () => {
		const root = resolveSkillRoot("pfd-retro");
		expect(existsSync(`${root}/SKILL.md`)).toBe(true);
	});

	it("resolves pfd-ecosystem to a directory containing SKILL.md", () => {
		const root = resolveSkillRoot("pfd-ecosystem");
		expect(existsSync(`${root}/SKILL.md`)).toBe(true);
	});
});

describe("copySkillTree", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("copies SKILL.md, references/ and install/ templates into the skill dir", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		copySkillTree(skillRoot, targetRoot);

		const skillMd = readFileSync(
			join(targetRoot, ".claude/skills/pfd-ops/SKILL.md"),
			"utf-8",
		);
		expect(skillMd).toContain("name: pfd-ops");

		const ref = readFileSync(
			join(
				targetRoot,
				".claude/skills/pfd-ops/references/github-issues-backend.md",
			),
			"utf-8",
		);
		expect(ref).toContain("GitHub Issues バックエンド");

		// install/ templates must land in the skill dir so a fresh adopter can run
		// `cp -r .claude/skills/pfd-ops/install/. .` to adopt L3.
		expect(
			existsSync(
				join(
					targetRoot,
					".claude/skills/pfd-ops/install/.github/workflows/check-pfd-ops-sync.yml",
				),
			),
		).toBe(true);
	});

	it("excludes CLAUDE.md (dev-repo-only guard) from the synced skill dir", () => {
		const skillRoot = resolveSkillRoot("pfdsl");
		copySkillTree(skillRoot, targetRoot);

		expect(existsSync(join(targetRoot, ".claude/skills/pfdsl/CLAUDE.md"))).toBe(
			false,
		);
	});

	it("removes a stale CLAUDE.md left by a prior sync of an older version", () => {
		const skillRoot = resolveSkillRoot("pfdsl");
		const dest = join(targetRoot, ".claude/skills/pfdsl");
		mkdirSync(dest, { recursive: true });
		writeFileSync(join(dest, "CLAUDE.md"), "stale dev-repo-only guard\n");

		copySkillTree(skillRoot, targetRoot);

		expect(existsSync(join(dest, "CLAUDE.md"))).toBe(false);
	});

	it("mirrors the whole skill tree, removing stale files (install/ included)", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		const dest = join(targetRoot, ".claude/skills/pfd-ops");
		mkdirSync(join(dest, "references"), { recursive: true });
		writeFileSync(join(dest, "references/STALE.md"), "stale content\n");
		mkdirSync(join(dest, "install"), { recursive: true });
		writeFileSync(join(dest, "install/STALE.txt"), "stale\n");

		copySkillTree(skillRoot, targetRoot);

		expect(existsSync(join(dest, "references/STALE.md"))).toBe(false);
		// install/ is mirrored too: stale local file gone, canonical templates present.
		expect(existsSync(join(dest, "install/STALE.txt"))).toBe(false);
		expect(existsSync(join(dest, "install/scripts/lib/yaml-require.mjs"))).toBe(
			true,
		);
	});

	it("returns the relative paths of dest files whose content differs from source before overwriting", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		const dest = join(targetRoot, ".claude/skills/pfd-ops");
		mkdirSync(dest, { recursive: true });
		writeFileSync(join(dest, "SKILL.md"), "locally edited content\n");

		const overwritten = copySkillTree(skillRoot, targetRoot);

		expect(overwritten).toContain("SKILL.md");
	});

	it("does not crash when a source file's dest counterpart is a directory (stale layout)", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		const dest = join(targetRoot, ".claude/skills/pfd-ops");
		// SKILL.md is a file in source; simulate a dest where it's a stale directory.
		mkdirSync(join(dest, "SKILL.md"), { recursive: true });
		writeFileSync(join(dest, "SKILL.md/nested.txt"), "leftover\n");

		expect(() => copySkillTree(skillRoot, targetRoot)).not.toThrow();
		// the stale directory is gone and SKILL.md is now the real file, post-sync.
		expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toContain(
			"name: pfd-ops",
		);
	});

	it("returns an empty array when no dest file differs from source", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		copySkillTree(skillRoot, targetRoot); // first sync: nothing to diff against yet

		const overwritten = copySkillTree(skillRoot, targetRoot); // second sync: dest now matches source

		expect(overwritten).toEqual([]);
	});
});

describe("isL3Adopted", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("returns false when no install/-derived file exists at target root", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		expect(isL3Adopted(skillRoot, targetRoot)).toBe(false);
	});

	it("returns true when at least one install/-derived file exists", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		mkdirSync(join(targetRoot, "scripts/lib"), { recursive: true });
		writeFileSync(
			join(targetRoot, "scripts/lib/yaml-require.mjs"),
			"// deployed copy\n",
		);
		expect(isL3Adopted(skillRoot, targetRoot)).toBe(true);
	});
});

describe("copyInstallLayer", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("copies install/ tree to target root when adopted", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		// simulate prior adoption
		mkdirSync(join(targetRoot, "scripts/lib"), { recursive: true });
		writeFileSync(join(targetRoot, "scripts/lib/yaml-require.mjs"), "old\n");

		const result = copyInstallLayer(skillRoot, targetRoot);

		expect(result.copied).toBe(true);
		const updated = readFileSync(
			join(targetRoot, "scripts/lib/yaml-require.mjs"),
			"utf-8",
		);
		expect(updated).not.toBe("old\n");
		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(true);
	});

	it("does not copy and returns guidance message when not adopted", () => {
		const skillRoot = resolveSkillRoot("pfd-ops");
		const result = copyInstallLayer(skillRoot, targetRoot);

		expect(result.copied).toBe(false);
		expect(result.message).toContain(
			"cp -r .claude/skills/pfd-ops/install/. .",
		);
		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(false);
	});
});

describe("pfdslDirGuidance", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("returns guidance when .pfdsl/ does not exist", () => {
		const msg = pfdslDirGuidance(targetRoot);
		expect(msg).toContain("pfd-ecosystem");
		expect(msg).toContain("scaffold");
	});

	it("returns guidance when .pfdsl/ exists but has no .pfdsl files", () => {
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		writeFileSync(join(targetRoot, ".pfdsl/notes.md"), "notes\n");
		const msg = pfdslDirGuidance(targetRoot);
		expect(msg).toContain("pfd-ecosystem");
	});

	it("returns empty string when .pfdsl/ has at least one .pfdsl file", () => {
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		writeFileSync(join(targetRoot, ".pfdsl/roadmap.pfdsl"), "existing\n");
		const msg = pfdslDirGuidance(targetRoot);
		expect(msg).toBe("");
	});
});

describe("ensureLabels", () => {
	it("returns guidance and does nothing when gh is not found", async () => {
		const execGh = () => {
			throw Object.assign(new Error("not found"), { code: "ENOENT" });
		};
		const result = await ensureLabels({ execGh, yes: false });
		expect(result.message).toContain("flow:managed");
		expect(result.message).toContain("flow:exempt");
		expect(result.message).toContain("manually");
		expect(result.created).toEqual([]);
	});

	it("returns a distinct non-fatal message when gh fails for a reason other than missing", async () => {
		const execGh = () => {
			throw new Error("auth required");
		};
		const result = await ensureLabels({ execGh, yes: false });
		expect(result.created).toEqual([]);
		expect(result.message).toContain("Failed");
		expect(result.message).toContain("auth required");
		expect(result.message).not.toContain("not found");
	});

	it("skips when no labels are missing", async () => {
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") {
				return "flow:managed\tcolor\tdesc\nflow:exempt\tcolor\tdesc\n";
			}
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const result = await ensureLabels({ execGh, yes: false });
		expect(result.created).toEqual([]);
	});

	it("does not treat a substring-overlapping label as present (exact match only)", async () => {
		const created: string[] = [];
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") {
				return "flow:managed-archive\tc\td\nlegacy-flow:exempt\tc\td\n";
			}
			if (args[0] === "label" && args[1] === "create") {
				created.push(args[2]!);
				return "";
			}
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const result = await ensureLabels({ execGh, yes: true });
		expect(result.created.sort()).toEqual(["flow:exempt", "flow:managed"]);
	});

	it("creates missing labels with --yes (no prompt)", async () => {
		const created: string[] = [];
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") return "";
			if (args[0] === "label" && args[1] === "create") {
				created.push(args[2]!);
				return "";
			}
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const result = await ensureLabels({ execGh, yes: true });
		expect(result.created.sort()).toEqual(["flow:exempt", "flow:managed"]);
		expect(created.sort()).toEqual(["flow:exempt", "flow:managed"]);
	});

	it("prompts and skips creation when answer is not y", async () => {
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") return "";
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const confirm = async () => false;
		const result = await ensureLabels({ execGh, yes: false, confirm });
		expect(result.created).toEqual([]);
	});

	it("prompts and creates when answer is y", async () => {
		const created: string[] = [];
		const execGh = (args: string[]) => {
			if (args[0] === "label" && args[1] === "list") return "";
			if (args[0] === "label" && args[1] === "create") {
				created.push(args[2]!);
				return "";
			}
			throw new Error(`unexpected gh call: ${args.join(" ")}`);
		};
		const confirm = async () => true;
		const result = await ensureLabels({ execGh, yes: false, confirm });
		expect(result.created.sort()).toEqual(["flow:exempt", "flow:managed"]);
	});
});

describe("runSkillSync", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("syncs general layer, skips install/, shows pfd-ecosystem guidance (unadopted repo)", async () => {
		const result = await runSkillSync({ targetRoot, yes: true });

		expect(
			existsSync(join(targetRoot, ".claude/skills/pfd-ops/SKILL.md")),
		).toBe(true);
		expect(
			existsSync(join(targetRoot, ".claude/skills/pfd-retro/SKILL.md")),
		).toBe(true);
		expect(
			existsSync(join(targetRoot, ".claude/skills/pfd-ecosystem/SKILL.md")),
		).toBe(true);
		expect(existsSync(join(targetRoot, ".claude/skills/pfdsl/SKILL.md"))).toBe(
			true,
		);
		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(false);
		expect(existsSync(join(targetRoot, ".pfdsl/roadmap.pfdsl"))).toBe(false);
		expect(existsSync(join(targetRoot, ".claude/commands/pfd-init.md"))).toBe(
			true,
		);
		expect(existsSync(join(targetRoot, ".claude/commands/pfd-cycle.md"))).toBe(
			true,
		);
		expect(existsSync(join(targetRoot, ".claude/commands/pfd-retro.md"))).toBe(
			true,
		);
		expect(existsSync(join(targetRoot, ".claude/agents/pfd-lens.md"))).toBe(
			true,
		);
		expect(result.stdout).toContain("cp -r .claude/skills/pfd-ops/install/. .");
		expect(result.stdout).toContain("pfd-ecosystem");
		expect(result.stdout).not.toContain("skill sync pfdsl");
		expect(result.stdout).not.toContain("warning: local edits overwritten");
		expect(result.exitCode).toBe(0);
	});

	it("warns with the file path when sync overwrites an adopter-local edit", async () => {
		mkdirSync(join(targetRoot, ".claude/skills/pfd-ops"), { recursive: true });
		writeFileSync(
			join(targetRoot, ".claude/skills/pfd-ops/SKILL.md"),
			"locally edited content\n",
		);

		const result = await runSkillSync({ targetRoot, yes: true });

		expect(result.stdout).toContain(
			"warning: local edits overwritten in .claude/skills/pfd-ops/: SKILL.md",
		);
		// sync still completes despite the warning (no --force gate).
		expect(
			readFileSync(
				join(targetRoot, ".claude/skills/pfd-ops/SKILL.md"),
				"utf-8",
			),
		).not.toContain("locally edited content");
		expect(result.exitCode).toBe(0);
	});

	it("copies install/ when already adopted, and does not print ecosystem guidance when .pfdsl has files", async () => {
		mkdirSync(join(targetRoot, "scripts/lib"), { recursive: true });
		writeFileSync(join(targetRoot, "scripts/lib/yaml-require.mjs"), "old\n");
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		writeFileSync(join(targetRoot, ".pfdsl/roadmap.pfdsl"), "existing\n");

		const result = await runSkillSync({
			targetRoot,
			yes: true,
			execGh: (args: string[]) =>
				args[0] === "label" && args[1] === "list"
					? "flow:managed\nflow:exempt\n"
					: "",
		});

		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(true);
		expect(result.stdout).not.toContain("has no files yet");
		expect(result.stdout).not.toContain("skill sync pfdsl");
		expect(result.exitCode).toBe(0);
	});
});
