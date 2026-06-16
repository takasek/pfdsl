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
	copyGeneralLayer,
	copyInstallLayer,
	ecosystemSetupPrompt,
	isL3Adopted,
	resolveSkillRoot,
	scaffoldL4Files,
} from "./skill-sync.js";

describe("resolveSkillRoot", () => {
	it("resolves to a directory containing SKILL.md", () => {
		const root = resolveSkillRoot();
		expect(existsSync(`${root}/SKILL.md`)).toBe(true);
	});
});

describe("copyGeneralLayer", () => {
	let targetRoot: string;

	beforeEach(() => {
		targetRoot = mkdtempSync(join(tmpdir(), "pfdsl-sync-test-"));
	});

	afterEach(() => {
		rmSync(targetRoot, { recursive: true, force: true });
	});

	it("copies SKILL.md and references/ unconditionally, excluding install/", () => {
		const skillRoot = resolveSkillRoot();
		copyGeneralLayer(skillRoot, targetRoot);

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

		expect(existsSync(join(targetRoot, ".claude/skills/pfd-ops/install"))).toBe(
			false,
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
			["ecosystem.md", "ecosystem.pfdsl", "roadmap.md", "roadmap.pfdsl"].sort(),
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
			["ecosystem.md", "ecosystem.pfdsl", "roadmap.md"].sort(),
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
			"ecosystem.pfdsl",
			"ecosystem.md",
		]) {
			writeFileSync(join(targetRoot, ".pfdsl", f), "existing\n");
		}

		const result = scaffoldL4Files(skillRoot, targetRoot);
		expect(result.scaffolded).toEqual([]);
	});
});

describe("ecosystemSetupPrompt", () => {
	it("returns the prompt content when scaffolded list is non-empty", () => {
		const skillRoot = resolveSkillRoot();
		const prompt = ecosystemSetupPrompt(skillRoot, ["roadmap.pfdsl"]);
		expect(prompt).toContain("ecosystem.pfdsl 構築プロンプト");
	});

	it("returns empty string when scaffolded list is empty", () => {
		const skillRoot = resolveSkillRoot();
		const prompt = ecosystemSetupPrompt(skillRoot, []);
		expect(prompt).toBe("");
	});
});
