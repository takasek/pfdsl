import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	EMPTY_TREE,
	SCOPE_EXCLUSIONS,
	canonicalSourceOf,
	diffBase,
	formatGateFailure,
	inScope,
	runDistributionReviewCheck,
	unreviewedFiles,
} from "./distribution-review.mjs";

describe("inScope", () => {
	it("takes a distributed prompt", () => {
		assert.equal(inScope("plugin/pfdsl/skills/pfd-ops/SKILL.md"), true);
		assert.equal(inScope("plugin/pfdsl/commands/pfd-cycle.md"), true);
		assert.equal(inScope("plugin/pfdsl/agents/pfd-lens.md"), true);
	});

	it("leaves out what is not markdown", () => {
		assert.equal(inScope("plugin/pfdsl/.claude-plugin/plugin.json"), false);
		assert.equal(inScope("plugin/pfdsl/hooks/retro-reminder-post-tool-use.mjs"), false);
		assert.equal(inScope("plugin/pfdsl/skills/pfd-ops/references/scaffold/roadmap.pfdsl"), false);
	});

	it("leaves out anything outside the distributed tree", () => {
		assert.equal(inScope(".claude/skills/pfd-ops/SKILL.md"), false);
		assert.equal(inScope("docs/quality-guide.md"), false);
	});

	it("leaves out the three generated references", () => {
		for (const path of Object.keys(SCOPE_EXCLUSIONS)) {
			assert.equal(inScope(path), false, path);
		}
	});

	it("names a reason for every exclusion, so the boundary stays arguable", () => {
		for (const [path, reason] of Object.entries(SCOPE_EXCLUSIONS)) {
			assert.ok(reason.length > 0, path);
		}
	});
});

describe("canonicalSourceOf", () => {
	it("maps a mirrored skill tree back to .claude/skills", () => {
		assert.equal(
			canonicalSourceOf("plugin/pfdsl/skills/pfd-ops/references/architecture.md"),
			".claude/skills/pfd-ops/references/architecture.md",
		);
	});

	it("maps commands and agents back to their .claude directories", () => {
		assert.equal(canonicalSourceOf("plugin/pfdsl/commands/pfd-cycle.md"), ".claude/commands/pfd-cycle.md");
		assert.equal(canonicalSourceOf("plugin/pfdsl/agents/pfd-lens.md"), ".claude/agents/pfd-lens.md");
	});

	it("maps the generated pfdsl skill to the template it is rendered from", () => {
		assert.equal(canonicalSourceOf("plugin/pfdsl/skills/pfdsl/SKILL.md"), "scripts/skill-template/SKILL.md");
	});

	it("maps each generated reference to the docs it is generated from", () => {
		assert.equal(canonicalSourceOf("plugin/pfdsl/skills/pfdsl/references/spec.md"), "docs/spec/spec.md");
		assert.equal(canonicalSourceOf("plugin/pfdsl/skills/pfdsl/references/quality-guide.md"), "docs/quality-guide.md");
		assert.equal(
			canonicalSourceOf("plugin/pfdsl/skills/pfdsl/references/review-perspectives.md"),
			"docs/review-perspectives.md",
		);
		assert.equal(canonicalSourceOf("plugin/pfdsl/skills/pfdsl/references/examples.md"), "docs/examples/");
		assert.equal(canonicalSourceOf("plugin/pfdsl/skills/pfdsl/references/samples.md"), "docs/samples/");
	});

	it("refuses a distributed file it has no origin for", () => {
		// A new bundled file with no known canonical source is a gap in this
		// map, not a file to review in place: reviewers would be sent to edit a
		// generated copy that the next `make gen-plugin` overwrites.
		assert.throws(() => canonicalSourceOf("plugin/pfdsl/skills/pfd-new/SKILL.md"), /no canonical source/);
	});
});

describe("the map against the bundle that actually ships", () => {
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
	const bundled = execFileSync("git", ["ls-files", "plugin/pfdsl/**/*.md"], { cwd: root, encoding: "utf-8" })
		.trim()
		.split("\n")
		.filter(Boolean);

	it("finds markdown in the bundle to check against", () => {
		assert.ok(bundled.length > 0);
	});

	it("resolves every bundled markdown file to a canonical source that exists", () => {
		for (const path of bundled) {
			const canonical = canonicalSourceOf(path);
			assert.ok(existsSync(resolve(root, canonical)), `${path} → ${canonical} does not exist`);
		}
	});

	it("holds out only files the bundle still has", () => {
		// An exclusion for a path that no longer ships is a hole nobody is
		// watching: it would silently widen if that path came back.
		for (const path of Object.keys(SCOPE_EXCLUSIONS)) {
			assert.ok(bundled.includes(path), `${path} is excluded but not bundled`);
		}
	});
});

describe("unreviewedFiles", () => {
	it("keeps only the in-scope paths, in order", () => {
		const changed = [
			"plugin/pfdsl/skills/pfd-retro/SKILL.md",
			"plugin/pfdsl/.claude-plugin/plugin.json",
			"plugin/pfdsl/skills/pfdsl/references/spec.md",
			"plugin/pfdsl/commands/pfd-init.md",
		];
		assert.deepEqual(unreviewedFiles(changed), [
			"plugin/pfdsl/skills/pfd-retro/SKILL.md",
			"plugin/pfdsl/commands/pfd-init.md",
		]);
	});

	it("is empty when nothing distributed changed", () => {
		assert.deepEqual(unreviewedFiles(["packages/cli/src/cli.ts", "docs/adr/README.md"]), []);
	});
});

describe("diffBase", () => {
	it("uses the recorded commit", () => {
		assert.equal(diffBase({ commit: "a".repeat(40) }), "a".repeat(40));
	});

	it("falls back to the empty tree when nothing has been reviewed yet", () => {
		// So the first diff-mode run is a full review by construction, with no
		// placeholder hash standing in for content nobody has read.
		assert.equal(diffBase({ commit: null }), EMPTY_TREE);
		assert.equal(diffBase({}), EMPTY_TREE);
	});
});

describe("formatGateFailure", () => {
	it("points at the canonical source of every unreviewed file", () => {
		const message = formatGateFailure({
			base: "abc1234",
			files: ["plugin/pfdsl/skills/pfd-ops/SKILL.md"],
		});
		assert.match(message, /\.claude\/skills\/pfd-ops\/SKILL\.md/);
		assert.match(message, /abc1234/);
	});

	it("says how to clear the gate", () => {
		const message = formatGateFailure({ base: EMPTY_TREE, files: ["plugin/pfdsl/commands/pfd-cycle.md"] });
		assert.match(message, /distribution-review/);
	});

	it("says the bundle has never been reviewed when the base is the empty tree", () => {
		const message = formatGateFailure({ base: EMPTY_TREE, files: ["plugin/pfdsl/commands/pfd-cycle.md"] });
		assert.match(message, /never been reviewed/);
	});
});

describe("runDistributionReviewCheck", () => {
	const deps = ({ record, changed = [], reachable = true }) => ({
		readRecord: () => record,
		commitExists: () => reachable,
		changedSince: () => changed,
	});

	it("passes when nothing distributed has moved since the reviewed commit", () => {
		const result = runDistributionReviewCheck(
			deps({ record: { commit: "a".repeat(40) }, changed: ["packages/cli/src/cli.ts"] }),
		);
		assert.equal(result.ok, true);
	});

	it("fails, naming the files, when a distributed prompt has moved", () => {
		const result = runDistributionReviewCheck(
			deps({ record: { commit: "a".repeat(40) }, changed: ["plugin/pfdsl/skills/pfd-ops/SKILL.md"] }),
		);
		assert.equal(result.ok, false);
		assert.match(result.message, /pfd-ops\/SKILL\.md/);
	});

	it("fails when the record is absent, rather than treating absence as approval", () => {
		const result = runDistributionReviewCheck(
			deps({ record: null, changed: ["plugin/pfdsl/skills/pfd-ops/SKILL.md"] }),
		);
		assert.equal(result.ok, false);
		assert.match(result.message, /never been reviewed/);
	});

	it("asks for a fetch when the reviewed commit is not in this clone", () => {
		// A shallow clone or a squash-merged branch can leave the recorded
		// commit unreachable. Passing there would approve by accident.
		const result = runDistributionReviewCheck(deps({ record: { commit: "b".repeat(40) }, reachable: false }));
		assert.equal(result.ok, false);
		assert.match(result.message, /git fetch/);
	});

	it("does not probe reachability of the empty tree", () => {
		let probed = false;
		const result = runDistributionReviewCheck({
			readRecord: () => ({ commit: null }),
			commitExists: () => {
				probed = true;
				return false;
			},
			changedSince: () => [],
		});
		assert.equal(probed, false);
		assert.equal(result.ok, true);
	});
});
