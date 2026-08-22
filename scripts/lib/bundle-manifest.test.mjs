import assert from "node:assert/strict";
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
	computeBundleContentHash,
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

describe("computeBundleContentHash", () => {
	it("is stable across repeated runs over the same content", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		writeFile(tmp, ".claude-plugin/plugin.json", '{"version":"1.2.3"}\n');
		assert.equal(computeBundleContentHash(tmp), computeBundleContentHash(tmp));
	});

	it("changes when a bundled file's content changes", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		const before = computeBundleContentHash(tmp);
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body edited\n");
		assert.notEqual(computeBundleContentHash(tmp), before);
	});

	it("changes when a file is added, even with identical content elsewhere", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		const before = computeBundleContentHash(tmp);
		writeFile(tmp, "skills/pfd-ops/extra.md", "body\n");
		assert.notEqual(computeBundleContentHash(tmp), before);
	});

	it("distinguishes identical content living at different paths", () => {
		writeFile(tmp, "a.md", "same\n");
		const a = computeBundleContentHash(tmp);
		rmSync(join(tmp, "a.md"));
		writeFile(tmp, "b.md", "same\n");
		assert.notEqual(computeBundleContentHash(tmp), a);
	});

	it("ignores the manifest it is about to write, so generation is idempotent", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		const withoutManifest = computeBundleContentHash(tmp);
		writeFile(
			tmp,
			BUNDLE_MANIFEST_RELATIVE_PATH,
			'{"contentHash":"whatever"}\n',
		);
		assert.equal(computeBundleContentHash(tmp), withoutManifest);
	});
});

describe("writeBundleManifest", () => {
	it("records the computed hash and re-writing it changes nothing", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		writeBundleManifest(tmp);
		const first = readFileSync(
			join(tmp, BUNDLE_MANIFEST_RELATIVE_PATH),
			"utf-8",
		);
		assert.equal(JSON.parse(first).contentHash, computeBundleContentHash(tmp));
		writeBundleManifest(tmp);
		assert.equal(
			readFileSync(join(tmp, BUNDLE_MANIFEST_RELATIVE_PATH), "utf-8"),
			first,
		);
	});

	it("creates the manifest directory when it does not exist yet", () => {
		writeFile(tmp, "skills/pfd-ops/SKILL.md", "body\n");
		writeBundleManifest(tmp);
		assert.ok(
			JSON.parse(
				readFileSync(join(tmp, BUNDLE_MANIFEST_RELATIVE_PATH), "utf-8"),
			).contentHash,
		);
	});
});
