import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("./check-spec-references.mjs", import.meta.url),
);

function check(text) {
	const dir = mkdtempSync(join(tmpdir(), "pfdsl-spec-reference-"));
	try {
		const file = join(dir, "draft.ts");
		writeFileSync(file, text);
		return spawnSync(process.execPath, [script, file], {
			cwd: dir,
			encoding: "utf8",
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe("check-spec-references entry point", () => {
	it("resolves a real specification ID from an explicit file outside the checkout", () => {
		const result = check("// [[SPEC_yaml_front_matter]]");
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, /1 sources, 1 ID references/);
	});

	it("rejects a typo against actual repository definitions", () => {
		const result = check("// [[SPEC_missing_external_reference_fixture]]"); // spec-ref-literal: misspelled reference under test
		assert.equal(result.status, 1);
		assert.match(result.stderr, /draft\.ts:1.*no definition/);
	});

	it("rejects a numbered reference and preserves an annotated output literal", () => {
		const bad = check("// See §15.17"); // spec-ref-literal: numbered reference under test
		assert.equal(bad.status, 1);
		assert.match(bad.stderr, /draft\.ts:1.*numbered/);
		const literal = check(
			'expect(output).toBe("§8"); // spec-ref-literal: explain output assertion',
		); // spec-ref-literal: annotation under test
		assert.equal(literal.status, 0, literal.stderr);
		assert.match(literal.stdout, /1 literal lines/);
	});

	it("reports read failures as errors rather than an empty successful corpus", () => {
		const result = spawnSync(
			process.execPath,
			[script, "missing-reference-fixture.ts"],
			{
				cwd: tmpdir(),
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 2);
		assert.match(result.stderr, /ENOENT/);
	});
});
