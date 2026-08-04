import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { writeSkillRefs } from "./gen-skill-refs.mjs";
import { collectModuleClosure, findDistDependentFiles } from "./check-script-imports.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

let tmp;
let fixtureRoot;
let outDir;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "gen-skill-refs-"));
	fixtureRoot = join(tmp, "root");
	outDir = join(tmp, "skill-out");

	mkdirSync(join(fixtureRoot, "docs/spec"), { recursive: true });
	writeFileSync(join(fixtureRoot, "docs/spec/spec.md"), "# PFDSL仕様書 v9.9.9\n\nbody\n");

	writeFileSync(join(fixtureRoot, "docs/review-perspectives.md"), "review body\n");
	writeFileSync(join(fixtureRoot, "docs/quality-guide.md"), "quality body\n");

	mkdirSync(join(fixtureRoot, "docs/samples"), { recursive: true });
	writeFileSync(
		join(fixtureRoot, "docs/samples/samples.tsv"),
		"id\tsummary\tdescription\nfoo\tFoo summary\tFoo description\n",
	);
	writeFileSync(join(fixtureRoot, "docs/samples/foo.pfdsl"), "process foo\n");

	mkdirSync(join(fixtureRoot, "docs/examples"), { recursive: true });
	writeFileSync(join(fixtureRoot, "docs/examples/bar.pfdsl"), '---\ntitle: "Bar"\n---\nprocess bar\n');
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("writeSkillRefs", () => {
	it("returns the spec version extracted from docs/spec/spec.md", () => {
		const specVersion = writeSkillRefs(fixtureRoot, outDir);
		assert.equal(specVersion, "v9.9.9");
	});

	it("writes references/spec.md with a DO NOT EDIT header followed by the source verbatim", () => {
		writeSkillRefs(fixtureRoot, outDir);
		const content = readFileSync(join(outDir, "references/spec.md"), "utf-8");
		assert.match(content, /^<!-- DO NOT EDIT/);
		assert.match(content, /# PFDSL仕様書 v9\.9\.9/);
		assert.match(content, /body/);
	});

	it("writes references/review-perspectives.md with a DO NOT EDIT header", () => {
		writeSkillRefs(fixtureRoot, outDir);
		const content = readFileSync(join(outDir, "references/review-perspectives.md"), "utf-8");
		assert.match(content, /^<!-- DO NOT EDIT/);
		assert.match(content, /review body/);
	});

	it("writes references/quality-guide.md with a DO NOT EDIT header", () => {
		writeSkillRefs(fixtureRoot, outDir);
		const content = readFileSync(join(outDir, "references/quality-guide.md"), "utf-8");
		assert.match(content, /^<!-- DO NOT EDIT/);
		assert.match(content, /quality body/);
	});

	it("writes references/samples.md from samples.tsv and the matching .pfdsl file", () => {
		writeSkillRefs(fixtureRoot, outDir);
		const content = readFileSync(join(outDir, "references/samples.md"), "utf-8");
		assert.match(content, /## foo — Foo summary/);
		assert.match(content, /Foo description/);
		assert.match(content, /process foo/);
	});

	it("writes references/examples.md indexing docs/examples/*.pfdsl", () => {
		writeSkillRefs(fixtureRoot, outDir);
		const content = readFileSync(join(outDir, "references/examples.md"), "utf-8");
		assert.match(content, /bar/);
		assert.match(content, /process bar/);
	});
});

describe("dist independence", () => {
	it("scripts/lib/gen-skill-refs.mjs and its module closure never reference packages/cli/dist or spawn a child process", () => {
		// The module itself, not a CLI wrapper around it: the wrapper was removed
		// in #668 once nothing called it, and this guarantee belongs to the code
		// that gen-skill.mjs and gen-plugin.mjs actually run.
		const entry = resolve(repoRoot, "scripts/lib/gen-skill-refs.mjs");
		const closure = collectModuleClosure(entry);

		assert.ok(closure.size >= 2, "expected the closure to include at least gen-skill-refs.mjs and a helper it imports");

		const violations = findDistDependentFiles([...closure]);
		assert.deepEqual(violations, [], violations.map((v) => `${v.file}: ${v.reason}`).join("; "));
	});
});
