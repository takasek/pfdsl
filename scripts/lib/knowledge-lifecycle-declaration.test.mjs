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
	it("SKILL points to the config key, classifier and audit reference", () => {
		assert.ok(dSection.includes(CONFIG_PATH));
		assert.ok(dSection.includes(KEY));
		assert.ok(dSection.includes("scripts/classify-knowledge-lifecycle.mjs"));
		assert.ok(dSection.includes("references/knowledge-lifecycle.md"));
		assert.ok(applicability.includes(CONFIG_PATH));
		assert.ok(applicability.includes(KEY));
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
