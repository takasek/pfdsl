import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
		writeFile(pluginRoot, ".claude-plugin/plugin.json", JSON.stringify({ version: localVersion }));
		return skillRoot;
	}

	function fakeFetch(remoteVersion) {
		return async () => ({
			ok: true,
			json: async () => ({ version: remoteVersion }),
		});
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
});
