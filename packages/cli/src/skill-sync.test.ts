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
	isL3Adopted,
	resolveSkillRoot,
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
