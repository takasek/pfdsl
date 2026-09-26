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
		assert.throws(() => writeBundleManifest(tmp), /newline/);
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
