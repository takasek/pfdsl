import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

it("generates a usable skill without upstream checker annotations", () => {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const template = join(root, "scripts/skill-template/SKILL.md");
	const before = readFileSync(template, "utf8");
	const dir = mkdtempSync(join(tmpdir(), "pfdsl-skill-annotations-"));
	try {
		const out = join(dir, "skills/pfdsl");
		const result = spawnSync(
			process.execPath,
			[join(root, "scripts/gen-skill.mjs"), "--out", out],
			{ cwd: root, encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		const generated = readFileSync(join(out, "SKILL.md"), "utf8");
		assert.doesNotMatch(generated, /<!--\s*spec-ref-literal:/);
		assert.match(generated, /§15\.16/); // spec-ref-literal: preserve the explain lookup example
		assert.match(generated, /DO NOT EDIT/);
		assert.equal(readFileSync(template, "utf8"), before);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
