import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { checkUpstreamVersion } from "../../.claude/skills/pfd-ops/scripts/plugin-version-check.mjs";

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
	// bundle-manifest.json for the content identifier. A test that only cares
	// about the version leaves the manifest side undefined, which stands for
	// "upstream has no manifest yet".
	function fakeFetch(remoteVersion, remoteContentHash) {
		return async (url) => {
			if (String(url).endsWith("bundle-manifest.json")) {
				return remoteContentHash === undefined
					? { ok: false }
					: {
							ok: true,
							json: async () => ({ contentHash: remoteContentHash }),
						};
			}
			return { ok: true, json: async () => ({ version: remoteVersion }) };
		};
	}

	function writeLocalBundleManifest(skillRoot, contentHash) {
		writeFile(
			join(skillRoot, "../.."),
			".claude-plugin/bundle-manifest.json",
			JSON.stringify({ contentHash }),
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
		writeLocalBundleManifest(skillRoot, "aaa");
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", "bbb"),
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
		writeLocalBundleManifest(skillRoot, "aaa");
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", "aaa"),
		);
		assert.equal(warning, null);
	});

	it("stays silent when the local bundle manifest is absent (every cache released before it existed)", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", "bbb"),
		);
		assert.equal(warning, null);
	});

	it("stays silent when the local bundle manifest is malformed", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		writeFile(
			join(skillRoot, "../.."),
			".claude-plugin/bundle-manifest.json",
			"{ not json",
		);
		const warning = await checkUpstreamVersion(
			skillRoot,
			fakeFetch("1.0.0", "bbb"),
		);
		assert.equal(warning, null);
	});

	it("stays silent when upstream has no bundle manifest to compare against", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		writeLocalBundleManifest(skillRoot, "aaa");
		const warning = await checkUpstreamVersion(skillRoot, fakeFetch("1.0.0"));
		assert.equal(warning, null);
	});

	it("reports the version difference without consulting the bundle manifest", async () => {
		const skillRoot = makePluginSkillRoot("1.0.0");
		writeLocalBundleManifest(skillRoot, "aaa");
		const fetched = [];
		const recordingFetch = async (url) => {
			fetched.push(String(url));
			return { ok: true, json: async () => ({ version: "2.0.0" }) };
		};
		const warning = await checkUpstreamVersion(skillRoot, recordingFetch);
		assert.match(warning, /2\.0\.0/);
		assert.deepEqual(
			fetched.filter((url) => url.endsWith("bundle-manifest.json")),
			[],
		);
	});
});
