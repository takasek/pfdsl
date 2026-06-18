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
	copyInstallLayer,
	copySkillTree,
	ecosystemSetupPrompt,
	ensureLabels,
	isL3Adopted,
	pfdslSkillGuidance,
	resolveSkillRoot,
	runSkillSync,
	scaffoldL4Files,
} from "./skill-sync.js";

describe("resolveSkillRoot", () => {
	it("resolves to a directory containing SKILL.md", () => {
		const root = resolveSkillRoot();
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
		const skillRoot = resolveSkillRoot();
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

	it("mirrors the whole skill tree, removing stale files (install/ included)", () => {
		const skillRoot = resolveSkillRoot();
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
		const skillRoot = resolveSkillRoot();
		expect(isL3Adopted(skillRoot, targetRoot)).toBe(false);
	});

	it("returns true when at least one install/-derived file exists", () => {
		const skillRoot = resolveSkillRoot();
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
		const skillRoot = resolveSkillRoot();
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
		const skillRoot = resolveSkillRoot();
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

describe("scaffoldL4Files", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("creates all 4 files under .pfdsl/ when none exist", () => {
		const skillRoot = resolveSkillRoot();
		const result = scaffoldL4Files(skillRoot, targetRoot);

		expect(result.scaffolded.sort()).toEqual(
			["workflow.md", "workflow.pfdsl", "roadmap.md", "roadmap.pfdsl"].sort(),
		);
		const roadmap = readFileSync(
			join(targetRoot, ".pfdsl/roadmap.pfdsl"),
			"utf-8",
		);
		expect(roadmap).toContain("seed");
	});

	it("does not touch a file that already exists", () => {
		const skillRoot = resolveSkillRoot();
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		writeFileSync(
			join(targetRoot, ".pfdsl/roadmap.pfdsl"),
			"# pre-existing custom content\n",
		);

		const result = scaffoldL4Files(skillRoot, targetRoot);

		expect(result.scaffolded).not.toContain("roadmap.pfdsl");
		expect(result.scaffolded.sort()).toEqual(
			["workflow.md", "workflow.pfdsl", "roadmap.md"].sort(),
		);
		const untouched = readFileSync(
			join(targetRoot, ".pfdsl/roadmap.pfdsl"),
			"utf-8",
		);
		expect(untouched).toBe("# pre-existing custom content\n");
	});

	it("returns empty scaffolded list when all 4 files already exist", () => {
		const skillRoot = resolveSkillRoot();
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		for (const f of [
			"roadmap.pfdsl",
			"roadmap.md",
			"workflow.pfdsl",
			"workflow.md",
		]) {
			writeFileSync(join(targetRoot, ".pfdsl", f), "existing\n");
		}

		const result = scaffoldL4Files(skillRoot, targetRoot);
		expect(result.scaffolded).toEqual([]);
	});
});

describe("pfdslSkillGuidance", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("returns guidance when pfdsl skill is absent", () => {
		const msg = pfdslSkillGuidance(targetRoot);
		expect(msg).toContain("pfdsl");
		expect(msg).toContain("skill sync pfdsl");
	});

	it("returns empty string when pfdsl skill is already installed", () => {
		mkdirSync(join(targetRoot, ".claude/skills/pfdsl"), { recursive: true });
		writeFileSync(join(targetRoot, ".claude/skills/pfdsl/SKILL.md"), "# pfdsl\n");
		const msg = pfdslSkillGuidance(targetRoot);
		expect(msg).toBe("");
	});
});

describe("ecosystemSetupPrompt", () => {
	it("returns the prompt content when scaffolded list is non-empty", () => {
		const skillRoot = resolveSkillRoot();
		const prompt = ecosystemSetupPrompt(skillRoot, ["roadmap.pfdsl"]);
		expect(prompt).toContain("pfd-ecosystem");
	});

	it("returns empty string when scaffolded list is empty", () => {
		const skillRoot = resolveSkillRoot();
		const prompt = ecosystemSetupPrompt(skillRoot, []);
		expect(prompt).toBe("");
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
		expect(result.message).toContain("手動");
		expect(result.created).toEqual([]);
	});

	it("returns a distinct non-fatal message when gh fails for a reason other than missing", async () => {
		const execGh = () => {
			throw new Error("auth required");
		};
		const result = await ensureLabels({ execGh, yes: false });
		expect(result.created).toEqual([]);
		expect(result.message).toContain("失敗");
		expect(result.message).toContain("auth required");
		expect(result.message).not.toContain("見つかりません");
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

	it("syncs general layer, skips install/, scaffolds L4, shows prompt (unadopted repo)", async () => {
		const result = await runSkillSync({ targetRoot, yes: true });

		expect(
			existsSync(join(targetRoot, ".claude/skills/pfd-ops/SKILL.md")),
		).toBe(true);
		expect(
			existsSync(join(targetRoot, ".github/workflows/check-pfd-ops-sync.yml")),
		).toBe(false);
		expect(existsSync(join(targetRoot, ".pfdsl/roadmap.pfdsl"))).toBe(true);
		expect(result.stdout).toContain("cp -r .claude/skills/pfd-ops/install/. .");
		expect(result.stdout).toContain("pfd-ecosystem");
		expect(result.stdout).toContain("skill sync pfdsl");
		expect(result.exitCode).toBe(0);
	});

	it("copies install/ when already adopted, and does not print ecosystem prompt when L4 already exists", async () => {
		mkdirSync(join(targetRoot, "scripts/lib"), { recursive: true });
		writeFileSync(join(targetRoot, "scripts/lib/yaml-require.mjs"), "old\n");
		mkdirSync(join(targetRoot, ".pfdsl"), { recursive: true });
		for (const f of [
			"roadmap.pfdsl",
			"roadmap.md",
			"workflow.pfdsl",
			"workflow.md",
		]) {
			writeFileSync(join(targetRoot, ".pfdsl", f), "existing\n");
		}

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
		expect(result.stdout).not.toContain("pfd-ecosystem");
		expect(result.exitCode).toBe(0);
	});
});
