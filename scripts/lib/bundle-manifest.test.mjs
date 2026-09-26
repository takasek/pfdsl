import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { readLocalBundleAggregateHash } from "../../.claude/skills/pfd-ops/scripts/plugin-version-check.mjs";
import {
	BUNDLE_MANIFEST_RELATIVE_PATH,
	writeBundleManifest,
} from "./bundle-manifest.mjs";

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "bundle-manifest-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeFile(root, relPath, content) {
	const full = join(root, ...relPath.split("/"));
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

function readManifest(root) {
	return readFileSync(join(root, BUNDLE_MANIFEST_RELATIVE_PATH), "utf-8");
}

function sha256(content) {
	return createHash("sha256").update(content).digest("hex");
}

describe("writeBundleManifest", () => {
	it("is stable across repeated runs over the same content", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		writeFile(tmp, ".claude-plugin/plugin.json", '{"version":"1.2.3"}\n');
		writeBundleManifest(tmp);
		const first = readManifest(tmp);
		writeBundleManifest(tmp);
		assert.equal(readManifest(tmp), first);
	});

	it("changes when a bundled file's content changes", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		writeBundleManifest(tmp);
		const before = readManifest(tmp);
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body edited\n");
		writeBundleManifest(tmp);
		assert.notEqual(readManifest(tmp), before);
	});

	it("changes when a file is added, even with identical content elsewhere", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		writeBundleManifest(tmp);
		const before = readManifest(tmp);
		writeFile(tmp, "skills/pfd-ops/extra.md", "body\n");
		writeBundleManifest(tmp);
		assert.notEqual(readManifest(tmp), before);
	});

	it("distinguishes identical content living at different paths", () => {
		writeFile(tmp, "a.md", "same\n");
		writeBundleManifest(tmp);
		const a = readManifest(tmp);
		rmSync(join(tmp, "a.md"));
		writeFile(tmp, "b.md", "same\n");
		writeBundleManifest(tmp);
		assert.notEqual(readManifest(tmp), a);
	});

	it("excludes the manifest it is about to write, so generation is idempotent", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		writeBundleManifest(tmp);
		const withoutStalePeer = readManifest(tmp);
		// A stale manifest already on disk (from a previous run, or a checkout
		// that predates a change to the bundled files) must not become an input
		// to the next manifest — otherwise regenerating twice in a row without
		// any bundled file changing would still change the output.
		writeFile(
			tmp,
			BUNDLE_MANIFEST_RELATIVE_PATH,
			"0000000000000000000000000000000000000000000000000000000000000000  stale\n",
		);
		writeBundleManifest(tmp);
		assert.equal(readManifest(tmp), withoutStalePeer);
	});

	it("throws when a bundled file's path contains a newline", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		writeFile(tmp, "a\nb.md", "content\n");
		assert.throws(() => writeBundleManifest(tmp), /line terminator/);
	});

	it("writes the exact per-file format: one line per file, sorted by path, blank line between entries, single trailing newline", () => {
		writeFile(tmp, "b.md", "content-b\n");
		writeFile(tmp, "a.md", "content-a\n");
		writeFile(tmp, "c/d.md", "content-d\n");
		writeBundleManifest(tmp);

		const hexA = sha256("content-a\n");
		const hexB = sha256("content-b\n");
		const hexD = sha256("content-d\n");
		const expected = `${hexA}  a.md\n\n${hexB}  b.md\n\n${hexD}  c/d.md\n`;
		assert.equal(readManifest(tmp), expected);
	});
});

// The writer lives here and the reader ships inside the pfd-ops skill, which
// cannot import this module, so the format is defined twice. This pins the two
// definitions to each other: the reader must aggregate the writer's real output
// to the bundle's content identifier.
describe("writer and reader round trip", () => {
	it("lets the pfd-ops reader aggregate the written manifest to the bundle's content identifier", () => {
		const files = {
			".claude-plugin/plugin.json": '{"version":"1.2.3"}\n',
			"skills/pfd-ops/SKILL.md": "body\n",
			"skills/pfd-ops/scripts/x.mjs": "export {};\n",
		};
		for (const [rel, content] of Object.entries(files)) {
			writeFile(tmp, rel, content);
		}
		writeBundleManifest(tmp);

		const expected = createHash("sha256");
		for (const rel of Object.keys(files).sort()) {
			expected.update(rel);
			expected.update("\0");
			expected.update(sha256(files[rel]));
			expected.update("\n");
		}
		assert.equal(readLocalBundleAggregateHash(tmp), expected.digest("hex"));
	});

	// Every file name the writer accepts must come back from the reader as the
	// old-definition aggregate of exactly that name, and the writer must refuse
	// exactly the names the reader cannot give back: those holding a character
	// the reader treats as a line boundary (JS regex line terminators, and the
	// CR it strips from CRLF).
	for (const [label, name, refused] of [
		["plain", "a.md", false],
		["space", "a b.md", false],
		["backslash", "a\\b.md", false],
		["non-ASCII", "é.md", false],
		["astral", "\u{1F600}.md", false],
		["leading spaces", "  a.md", false],
		["trailing CR", "a.md\r", true],
		["embedded CR", "a\rb.md", true],
		["LF", "a\nb.md", true],
		["U+2028", "a\u2028b.md", true],
		["U+2029", "a\u2029b.md", true],
	]) {
		it(`${refused ? "refuses" : "round-trips"} a file name with ${label}`, () => {
			writeFile(tmp, "base.md", "base\n");
			writeFile(tmp, name, "content\n");
			if (refused) {
				assert.throws(() => writeBundleManifest(tmp), /line terminator/);
				return;
			}
			writeBundleManifest(tmp);
			const expected = createHash("sha256");
			for (const [rel, content] of [
				["base.md", "base\n"],
				[name, "content\n"],
			].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
				expected.update(rel);
				expected.update("\0");
				expected.update(sha256(content));
				expected.update("\n");
			}
			assert.equal(readLocalBundleAggregateHash(tmp), expected.digest("hex"));
		});
	}

	it("refuses to write a manifest for a bundle with no files, which the reader could not tell from a truncated one", () => {
		assert.throws(() => writeBundleManifest(tmp), /no files/);
	});
});
