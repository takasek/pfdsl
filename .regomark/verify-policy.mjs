import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Opt-in scenarios for maintainers with regomark installed.
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
		process.execPath,
		[fileURLToPath(new URL("./check-adr.mjs", import.meta.url)), "--json"],
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

test("ignores related links outside the replacement declaration", (t) => {
	const old =
		first +
		"\n- Related: [PR implementing ADR-0002](https://example.org/pr/3)\n";
	assert.deepEqual(check(t, { old }), []);
});

test("distinguishes the same label on different loose-list items", (t) => {
	const old =
		first +
		"\n- Related: [ADR-0002](https://example.org/pr/3)\n\n- Date: 2026\n";
	assert.deepEqual(check(t, { old }), []);
	const broken = old.replace("by ADR-0002", "by [ADR-0002](missing.md)");
	assert.deepEqual(check(t, { old: broken }), [
		["adr-replacement", "0001-old.md", 3],
	]);
});

test("checks replacements in nested list items and reference-style fields", (t) => {
	const nested =
		"# ADR-0001: Old\n\n- Top\n  - Nested\n    - Status: Superseded by [ADR-0002](missing.md)\n";
	const referenced =
		"# ADR-0001: Old\n\n- [Status:][field] Superseded by [ADR-0002](missing.md)\n\n[field]: https://example.org/status\n";
	assert.deepEqual(check(t, { old: nested }), [
		["adr-replacement", "0001-old.md", 5],
	]);
	assert.deepEqual(check(t, { old: referenced }), [
		["adr-replacement", "0001-old.md", 3],
	]);
});

test("reports a bad replacement link alongside other policy violations", (t) => {
	const old = first
		.replace("# ADR-0001", "# ADR-0999")
		.replace("by ADR-0002", "by [ADR-0002](missing.md)");
	assert.deepEqual(check(t, { old }), [
		["adr-heading", "0001-old.md", 1],
		["adr-replacement", "0001-old.md", 3],
	]);
});
