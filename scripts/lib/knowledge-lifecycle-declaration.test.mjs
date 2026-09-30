import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { HARNESS_CAPABILITY_CONTRACT } from "./harness-inventory.mjs";

// The pfd-retro D-layer adoption declaration is a discrete switch plus a list,
// so it lives in the git-managed .pfdsl/config.json under the key
// `knowledgeLifecycleAudit`: {"mode": "adopt" | "decline", "targets": [...]}.
// Prose in the binding is never a declaration, and the two earlier line
// forms are not recognized. The SKILL, the scaffold and this repo's config
// must agree on the literal key.
const KEY = "knowledgeLifecycleAudit";
const CONFIG_PATH = ".pfdsl/config.json";
const RETIRED_LINES =
	/^(knowledge-lifecycle-audit|知識成果物ライフサイクル監査):/m;

const read = (path) => readFileSync(path, "utf8");
const skill = read(".claude/skills/pfd-retro/SKILL.md");
const reference = read(
	".claude/skills/pfd-retro/references/knowledge-lifecycle.md",
);
const scaffoldBinding = read(
	".claude/skills/pfd-ops/references/scaffold/bindings/pfd-retro.md",
);
const repoBinding = read(".pfdsl/bindings/pfd-retro.md");
const scaffoldConfig = JSON.parse(
	read(".claude/skills/pfd-ops/references/scaffold/config.json"),
);
const repoConfig = JSON.parse(read(CONFIG_PATH));

function section(markdown, heading) {
	const start = markdown.indexOf(`\n## ${heading}`);
	assert.notEqual(start, -1, `heading not found: ${heading}`);
	const next = markdown.indexOf("\n## ", start + 1);
	return markdown.slice(start, next === -1 ? undefined : next);
}

const dSection = section(skill, "D. 知識成果物のライフサイクル（選択項目）");
const applicability = section(skill, "適用単位");

describe("pfd-retro D-layer declaration in .pfdsl/config.json", () => {
	it("SKILL D section names the config file, the key, both modes and targets", () => {
		assert.ok(dSection.includes(CONFIG_PATH));
		assert.ok(dSection.includes(KEY));
		assert.match(dSection, /`adopt`/);
		assert.match(dSection, /`decline`/);
		assert.match(dSection, /`targets`/);
	});

	it("SKILL D section states the report-every-run rule for every other state", () => {
		// Match within the sentence that enumerates the invalid states only:
		// phrases like 空 or `mode` also occur where the value's shape is
		// described, so a whole-section search would pass with a state dropped.
		const enumeration = dSection
			.split("\n")
			.find((line) => line.startsWith("それ以外の状態はすべて"));
		assert.ok(enumeration, "the invalid-state sentence is missing");
		assert.match(enumeration, /毎回報告する/);
		for (const state of [
			"config ファイルが無い",
			"JSON として読めない",
			"最上位がオブジェクトでない",
			"キーが無い",
			"キーがオブジェクトでない",
			"`mode` が無い",
			"`adopt` と `decline` のどちらでもない",
			"`adopt` なのに `targets` が無い・空",
			"空文字列",
		]) {
			assert.ok(enumeration.includes(state), `state not covered: ${state}`);
		}
	});

	it("SKILL D section says a heading or prose is never a declaration and tells old adopters where to go", () => {
		assert.match(dSection, /節見出し/);
		assert.match(dSection, /knowledge-lifecycle-audit:/);
		assert.match(dSection, /知識成果物ライフサイクル監査:/);
		assert.match(dSection, /移った/);
	});

	it("SKILL D section reports a retired line even when the config declines", () => {
		// A repo with an old adopt line that receives the scaffold's decline
		// config would otherwise stop the audit with no report at all.
		const retiredRule = dSection
			.split("\n")
			.find((line) => line.startsWith("節見出しや binding の散文"));
		assert.ok(retiredRule, "the retired-line rule is missing");
		assert.match(retiredRule, /`decline` でも/);
		assert.match(retiredRule, /毎回報告する/);
	});

	it("SKILL applicability sentence points to the config and covers absent, invalid and malformed", () => {
		assert.ok(applicability.includes(CONFIG_PATH));
		assert.ok(applicability.includes(KEY));
		for (const state of ["無い", "不正", "形式"]) {
			assert.ok(applicability.includes(state), `state not covered: ${state}`);
		}
		assert.doesNotMatch(applicability, /採用を宣言したときだけ/);
	});

	it("the D reference names the config key rather than a binding line", () => {
		assert.ok(reference.includes(KEY));
		assert.ok(reference.includes(CONFIG_PATH));
		assert.doesNotMatch(reference, /knowledge-lifecycle-audit/);
	});

	it("scaffold config declines the D layer", () => {
		assert.deepEqual(scaffoldConfig, { [KEY]: { mode: "decline" } });
	});

	it("this repo's config adopts with non-empty string targets", () => {
		const declaration = repoConfig[KEY];
		assert.equal(declaration.mode, "adopt");
		assert.ok(Array.isArray(declaration.targets));
		assert.ok(declaration.targets.length > 0);
		for (const target of declaration.targets) {
			assert.equal(typeof target, "string");
			assert.notEqual(target.trim(), "");
		}
	});

	it("this repo's config keeps the existing sweep opt-in", () => {
		assert.equal(repoConfig.sweepCompletedChains.enabled, true);
	});

	it("neither binding carries a retired declaration line", () => {
		assert.doesNotMatch(scaffoldBinding, RETIRED_LINES);
		assert.doesNotMatch(repoBinding, RETIRED_LINES);
	});

	it("both bindings point to the config key instead", () => {
		assert.ok(scaffoldBinding.includes(KEY));
		assert.ok(scaffoldBinding.includes(CONFIG_PATH));
		assert.ok(repoBinding.includes(KEY));
		assert.ok(repoBinding.includes(CONFIG_PATH));
	});

	it("pfd-ops distributes the scaffold config so /pfd-init can copy it", () => {
		const opsSkill = HARNESS_CAPABILITY_CONTRACT.find(
			(entry) => entry.id === "skill:pfd-ops",
		);
		assert.ok(
			opsSkill.source.files.includes("references/scaffold/config.json"),
		);
		const ecosystem = read(".claude/skills/pfd-ecosystem/SKILL.md");
		assert.match(ecosystem, /<scaffold>\/config\.json/);
	});
});
