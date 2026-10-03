import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { classifyDeclaration } from "../../.claude/skills/pfd-retro/scripts/classify-knowledge-lifecycle.mjs";

const key = "knowledgeLifecycleAudit";
const json = (declaration) => JSON.stringify({ [key]: declaration });
const sourcePath =
	".claude/skills/pfd-retro/scripts/classify-knowledge-lifecycle.mjs";

describe("knowledge lifecycle classification", () => {
	for (const [name, input, state] of [
		["missing config", undefined, "missing-config"],
		["invalid JSON", "{", "invalid-json"],
		...["null", "[]", "1", '"text"'].map((input) => [
			"invalid root",
			input,
			"invalid-config",
		]),
		["missing key", "{}", "missing-declaration"],
		...[null, [], "adopt", 1].map((value) => [
			"invalid declaration",
			json(value),
			"invalid-declaration",
		]),
		...[{}, { mode: null }, { mode: "other" }].map((value) => [
			"invalid mode",
			json(value),
			"invalid-mode",
		]),
		...[
			undefined,
			[],
			"docs/adr/",
			[1],
			[""],
			[" \t\n"],
			["docs/adr/", false],
		].map((targets) => [
			"invalid targets",
			json({ mode: "adopt", targets }),
			"invalid-targets",
		]),
	]) {
		it(`${name}: ${input}`, () => {
			const result = classifyDeclaration(input);
			assert.equal(result.state, state);
			assert.deepEqual(result.auditTargets, []);
			assert.equal(result.reportRequired, true);
			assert.equal(result.reports[0].code, state);
		});
	}

	it("returns exactly the adopted targets, preserving their text", () => {
		const targets = [" docs/adr/ ", "the criteria of .pfdsl/roadmap.pfdsl"];
		assert.deepEqual(classifyDeclaration(json({ mode: "adopt", targets })), {
			state: "adopt",
			auditTargets: targets,
			reportRequired: false,
			reports: [],
		});
	});

	it("decline ignores targets of every shape", () => {
		for (const targets of [undefined, null, [], "wrong shape", [1], [" "]]) {
			assert.deepEqual(
				classifyDeclaration(json({ mode: "decline", targets })),
				{
					state: "decline",
					auditTargets: [],
					reportRequired: false,
					reports: [],
				},
			);
		}
	});

	it("reports either retired declaration in every config state without adopting it", () => {
		for (const old of [
			"knowledge-lifecycle-audit: adopt docs/adr/",
			"知識成果物ライフサイクル監査: 採用 docs/adr/",
		]) {
			for (const config of [
				undefined,
				"{",
				"{}",
				json({ mode: "decline" }),
				json({ mode: "adopt", targets: ["only-this"] }),
			]) {
				const result = classifyDeclaration(config, old);
				assert.equal(result.reportRequired, true);
				assert.equal(result.reports.at(-1).code, "retired-declaration");
				assert.deepEqual(
					result.auditTargets,
					config?.includes("only-this") ? ["only-this"] : [],
				);
			}
		}
	});

	it("does not treat a heading or quoted example as an old declaration", () => {
		const binding =
			"## knowledge-lifecycle-audit\nUse `knowledge-lifecycle-audit:` as an example.\n";
		assert.equal(
			classifyDeclaration(json({ mode: "decline" }), binding).reportRequired,
			false,
		);
	});
});

describe("distributed classifier CLI", () => {
	it("runs when its entry path uses a filesystem alias", () => {
		const adopter = mkdtempSync(resolve(tmpdir(), "pfdsl-1344-alias-"));
		try {
			const entry = resolve(adopter, "classifier.mjs");
			symlinkSync(resolve(sourcePath), entry);
			const output = JSON.parse(
				execFileSync(process.execPath, [entry, adopter], { encoding: "utf8" }),
			);
			assert.equal(output.state, "missing-config");
			assert.equal(output.reportRequired, true);
		} finally {
			rmSync(adopter, { recursive: true, force: true });
		}
	});
	it("reads adopter files through each shipped entry, outside the upstream cwd", () => {
		const adopter = mkdtempSync(resolve(tmpdir(), "pfdsl-1344-classifier-"));
		try {
			mkdirSync(resolve(adopter, ".pfdsl/bindings"), { recursive: true });
			writeFileSync(
				resolve(adopter, ".pfdsl/config.json"),
				json({ mode: "decline", targets: [1] }),
			);
			writeFileSync(
				resolve(adopter, ".pfdsl/bindings/pfd-retro.md"),
				"knowledge-lifecycle-audit: adopt\n",
			);
			for (const root of [
				".claude/skills",
				".agents/skills",
				"plugin/pfdsl/skills",
				"plugin/pfdsl-codex/skills",
			]) {
				const script = resolve(
					root,
					"pfd-retro/scripts/classify-knowledge-lifecycle.mjs",
				);
				const skill = readFileSync(resolve(root, "pfd-retro/SKILL.md"), "utf8");
				assert.ok(skill.includes("scripts/classify-knowledge-lifecycle.mjs"));
				const output = JSON.parse(
					execFileSync(process.execPath, [script, adopter], {
						cwd: tmpdir(),
						encoding: "utf8",
					}),
				);
				assert.equal(output.state, "decline");
				assert.deepEqual(output.auditTargets, []);
				assert.equal(output.reportRequired, true);
				assert.equal(output.reports[0].code, "retired-declaration");
			}
		} finally {
			rmSync(adopter, { recursive: true, force: true });
		}
	});

	it("fails visibly on unreadable files rather than treating them as absent", () => {
		const adopter = mkdtempSync(resolve(tmpdir(), "pfdsl-1344-read-error-"));
		try {
			mkdirSync(resolve(adopter, ".pfdsl/config.json"), { recursive: true });
			const result = spawnSync(
				process.execPath,
				[resolve(sourcePath), adopter],
				{ encoding: "utf8" },
			);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, /config\.json/);
			assert.equal(result.stdout, "");
		} finally {
			rmSync(adopter, { recursive: true, force: true });
		}
	});
});
