import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
	checkUpstreamVersion,
	computeManifestAggregateHash,
} from "../../.claude/skills/pfd-ops/scripts/plugin-version-check.mjs";

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "plugin-version-check-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeFile(root, relPath, content) {
	const full = join(root, ...relPath.split("/"));
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

function hexOf(seed) {
	return createHash("sha256").update(seed).digest("hex");
}

/** @param {{path: string, hex: string}[]} entries */
function manifestText(entries) {
	return `${entries.map(({ hex, path }) => `${hex}  ${path}`).join("\n\n")}\n`;
}

describe("checkUpstreamVersion", () => {
	function makePluginSkillRoot(localVersion) {
		const pluginRoot = join(tmp, "plugin-root");
		const skillRoot = join(pluginRoot, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeFile(
			pluginRoot,
			".claude-plugin/plugin.json",
			JSON.stringify({ version: localVersion }),
		);
		return skillRoot;
	}

	// Two upstream files are consulted: plugin.json for the released version and
	// bundle-manifest.sha256 for the per-file digests a Note is computed from. A
	// test that only cares about the version leaves the manifest side
	// undefined, which stands for "upstream has no manifest yet".
	function fakeFetch(remoteVersion, remoteManifestText) {
		return async (url) => {
			if (String(url).endsWith("bundle-manifest.sha256")) {
				return remoteManifestText === undefined
					? { ok: false }
					: { ok: true, text: async () => remoteManifestText };
			}
			return { ok: true, json: async () => ({ version: remoteVersion }) };
		};
	}

	function writeLocalBundleManifest(skillRoot, text) {
		writeFile(
			join(skillRoot, "../.."),
			".claude-plugin/bundle-manifest.sha256",
			text,
		);
	}

	it("returns a warning string when the upstream version differs", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const warning = await checkUpstreamVersion(skillRoot, fakeFetch("2.0.0"));
		assert.match(warning, /1\.0\.0/);
		assert.match(warning, /2\.0\.0/);
	});

	it("returns null when the upstream version matches", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const warning = await checkUpstreamVersion(skillRoot, fakeFetch("1.0.0"));
		assert.equal(warning, null);
	});

	it("returns null silently when the injected fetch rejects", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const rejectingFetch = async () => {
			throw new Error("network down");
		};
		const warning = await checkUpstreamVersion(skillRoot, rejectingFetch);
		assert.equal(warning, null);
	});

	it("returns null silently when the local plugin.json is absent (repo-local run)", async () => {
		const skillRoot = join(tmp, "repo-local-skill");
		mkdirSync(skillRoot, { recursive: true });
		const warning = await checkUpstreamVersion(skillRoot, fakeFetch("2.0.0"));
		assert.equal(warning, null);
	});

	it("reports a content difference when the version matches but the bundle does not", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const localText = manifestText([{ hex: hexOf("a"), path: "a.md" }]);
		const remoteText = manifestText([{ hex: hexOf("b"), path: "a.md" }]);
		writeLocalBundleManifest(skillRoot, localText);
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", remoteText),
		);
		assert.match(warning, /content/i);
		// The marketplace source pins a release tag (.claude-plugin/marketplace.json
		// -> source.ref), not main. A bundle change on main has no release to
		// update to, so telling the reader to update the plugin would be an
		// instruction they cannot carry out — on every adopting repo, until the
		// next CLI release.
		assert.doesNotMatch(warning, /updat/i);
	});

	it("returns null when the version matches and the bundle content matches", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const text = manifestText([{ hex: hexOf("a"), path: "a.md" }]);
		writeLocalBundleManifest(skillRoot, text);
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", text),
		);
		assert.equal(warning, null);
	});

	it("returns null when the two manifests list the same entries in a different order", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const localText = manifestText([
			{ hex: hexOf("a"), path: "a.md" },
			{ hex: hexOf("b"), path: "b.md" },
		]);
		const remoteText = manifestText([
			{ hex: hexOf("b"), path: "b.md" },
			{ hex: hexOf("a"), path: "a.md" },
		]);
		writeLocalBundleManifest(skillRoot, localText);
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", remoteText),
		);
		assert.equal(warning, null);
	});

	it("stays silent when the local bundle manifest is absent (every cache released before it existed)", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const remoteText = manifestText([{ hex: hexOf("b"), path: "a.md" }]);
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", remoteText),
		);
		assert.equal(warning, null);
	});

	it("stays silent when the local plugin only carries the old bundle-manifest.json format", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		writeFile(
			join(skillRoot, "../.."),
			".claude-plugin/bundle-manifest.json",
			JSON.stringify({ contentHash: "aaa" }),
		);
		const remoteText = manifestText([{ hex: hexOf("b"), path: "a.md" }]);
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", remoteText),
		);
		assert.equal(warning, null);
	});

	it("stays silent when the local bundle manifest is malformed", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		writeLocalBundleManifest(skillRoot, "not a manifest\n");
		const remoteText = manifestText([{ hex: hexOf("b"), path: "a.md" }]);
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", remoteText),
		);
		assert.equal(warning, null);
	});

	it("stays silent when upstream has no bundle manifest to compare against", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		writeLocalBundleManifest(
			skillRoot,
			manifestText([{ hex: hexOf("a"), path: "a.md" }]),
		);
		const warning = await checkUpstreamVersion(skillRoot, fakeFetch("1.0.0"));
		assert.equal(warning, null);
	});

	it("stays silent when upstream's bundle manifest is malformed", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		writeLocalBundleManifest(
			skillRoot,
			manifestText([{ hex: hexOf("a"), path: "a.md" }]),
		);
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", "garbage, not a manifest"),
		);
		assert.equal(warning, null);
	});

	it("reports the version difference without consulting the bundle manifest", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		writeLocalBundleManifest(
			skillRoot,
			manifestText([{ hex: hexOf("a"), path: "a.md" }]),
		);
		const fetched = [];
		const recordingFetch = async (url) => {
			fetched.push(String(url));
			return { ok: true, json: async () => ({ version: "2.0.0" }) };
		};
		const warning = await checkUpstreamVersion(skillRoot, recordingFetch);
		assert.match(warning, /2\.0\.0/);
		assert.deepEqual(
			fetched.filter((url) => url.endsWith("bundle-manifest.sha256")),
			[],
		);
	});
});

describe("computeManifestAggregateHash", () => {
	it("matches the pre-#1264 aggregate definition: sha256 of path + \\0 + hex + \\n per entry, in path order", () => {
		const entries = [
			{ path: "a.md", hex: hexOf("a") },
			{ path: "b.md", hex: hexOf("b") },
		];
		const text = manifestText(entries);
		const expected = createHash("sha256");
		for (const { path, hex } of entries) {
			expected.update(path);
			expected.update("\0");
			expected.update(hex);
			expected.update("\n");
		}
		assert.equal(computeManifestAggregateHash(text), expected.digest("hex"));
	});

	it("returns null for an empty manifest", () => {
		assert.equal(computeManifestAggregateHash(""), null);
	});

	it("returns null for a manifest with a non-blank separator line", () => {
		const bad = `${hexOf("a")}  a.md\nnot blank\n${hexOf("b")}  b.md\n`;
		assert.equal(computeManifestAggregateHash(bad), null);
	});

	it("returns null for a duplicate path", () => {
		const hex = hexOf("a");
		const bad = `${hex}  a.md\n\n${hex}  a.md\n`;
		assert.equal(computeManifestAggregateHash(bad), null);
	});

	it("returns null for an empty path", () => {
		const bad = `${hexOf("a")}  \n`;
		assert.equal(computeManifestAggregateHash(bad), null);
	});

	it("returns null when the digest is not 64 lowercase hex characters", () => {
		const bad = "not-hex-at-all-and-way-too-short  a.md\n";
		assert.equal(computeManifestAggregateHash(bad), null);
	});

	it("returns null when the digest and path are not separated by two spaces", () => {
		const bad = `${hexOf("a")} a.md\n`;
		assert.equal(computeManifestAggregateHash(bad), null);
	});
});
