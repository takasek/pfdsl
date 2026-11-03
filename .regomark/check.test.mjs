import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Run the real checker in a throwaway Git repository, never against edited ADRs.
const first = "# ADR-0001: Old\n\n- Status: Superseded by ADR-0002\n";
const next =
	"# ADR-0002: New\n\n- Status: Accepted\n- Partially supersedes: ADR-0001\n";
const index =
	"# ADRs\n\n## 一覧\n\n- **ADR-0001** [Old](0001-old.md) ([notes](notes/log.md))\n- **ADR-0002** [New](0002-new.md)\n";

function check(t, { old = first, newer = next, list = index } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pfdsl-adr-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	execFileSync("git", ["init", "--quiet", dir]);
	cpSync(
		new URL("../.regomark.yaml", import.meta.url),
		join(dir, ".regomark.yaml"),
	);
	cpSync(new URL("./policy", import.meta.url), join(dir, ".regomark/policy"), {
		recursive: true,
	});
	const docs = join(dir, "docs/adr");
	mkdirSync(join(docs, "notes"), { recursive: true });
	for (const [name, body] of Object.entries({
		"0001-old.md": old,
		"0002-new.md": newer,
		"0001-v0.0.2.md": "Historical spec, not an ADR.",
		"README.md": list,
		"notes/log.md": "Notes",
	}))
		writeFileSync(join(docs, name), body);

	const run = spawnSync(
		"regomark",
		["check", "--no-judge", "--format", "json"],
		{ cwd: dir, encoding: "utf8" },
	);
	if (run.error) throw run.error;
	assert.ok([0, 1].includes(run.status), run.stderr);
	const hits = JSON.parse(run.stdout);
	assert.equal(run.status, hits.length ? 1 : 0);
	return hits.map(({ rule, path, line }) => [
		rule,
		path.split("/").pop(),
		line,
	]);
}

test("accepts partial and full replacements, supporting links, and the historical spec", (t) => {
	assert.deepEqual(check(t), []);
});

test("rejects a filename/H1 mismatch", (t) => {
	assert.deepEqual(
		check(t, { newer: next.replace("# ADR-0002", "# ADR-0003") }),
		[["adr-heading", "0002-new.md", 1]],
	);
});

test("reports the broken index link and the ADR missing from the index", (t) => {
	assert.deepEqual(
		check(t, { list: index.replace("(0002-new.md)", "(typo.md)") }),
		[
			["adr-index", "0002-new.md", 1],
			["adr-index", "README.md", 6],
		],
	);
});

test("rejects a missing partial replacement at the metadata line", (t) => {
	assert.deepEqual(
		check(t, {
			newer: next.replace("supersedes: ADR-0001", "supersedes: ADR-0999"),
		}),
		[["adr-replacement", "0002-new.md", 4]],
	);
});

test("checks each successor even when another successor exists", (t) => {
	const old = first.replace(
		"by ADR-0002",
		"in part by ADR-0002 (A), Superseded in part by ADR-0999 (B)",
	);
	assert.deepEqual(check(t, { old }), [["adr-replacement", "0001-old.md", 3]]);
});

test("detects an unlinked index entry even when it repeats a linked title", (t) => {
	assert.deepEqual(check(t, { list: index + "- **ADR-0999** New\n" }), [
		["adr-index", "README.md", 5],
	]);
});

test("checks a replacement link on its physical line in a loose list", (t) => {
	const old =
		"# ADR-0001: Old\n\n- Date: 2026\n\n- Status: Superseded by [ADR-0002: New](missing.md)\n";
	assert.deepEqual(check(t, { old }), [["adr-replacement", "0001-old.md", 5]]);
});
