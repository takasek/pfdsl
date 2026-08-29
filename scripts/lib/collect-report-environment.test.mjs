import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { collectReportEnvironment } from "../../.claude/skills/pfd-ops/scripts/collect-report-environment.mjs";

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "collect-report-environment-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeJson(path, value) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value));
}

const noCommands = () => null;

describe("collectReportEnvironment", () => {
	it("reports version and bundle hash for a Claude plugin installation", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "0.4.2" });
		writeJson(join(tmp, ".claude-plugin", "bundle-manifest.json"), {
			contentHash: "abc123",
		});

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "claude-plugin");
		assert.equal(env.pluginVersion, "0.4.2");
		assert.equal(env.bundleContentHash, "abc123");
	});

	it("reports the Codex plugin version and records the missing bundle hash", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".codex-plugin", "plugin.json"), { version: "0.4.2" });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "codex-plugin");
		assert.equal(env.pluginVersion, "0.4.2");
		assert.equal(env.bundleContentHash, null);
		assert.deepEqual(
			env.unavailable.map(({ field }) => field),
			["bundleContentHash"],
		);
		assert.match(env.unavailable[0].reason, /Codex/);
	});

	it("classifies a repo-local install and carries its provenance", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		writeJson(join(repoRoot, "pfd-ops-install-manifest.json"), {
			version: "0.4.2",
		});

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "repo-local");
		assert.equal(env.pluginVersion, null);
		assert.deepEqual(env.installProvenance, { version: "0.4.2" });
	});

	it("classifies the upstream checkout by its own distribution sources", () => {
		const repoRoot = join(tmp, "pfdsl");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		writeJson(join(repoRoot, "plugin/pfdsl/.claude-plugin/plugin.json"), {
			version: "0.4.2",
		});
		mkdirSync(join(repoRoot, "scripts", "lib"), { recursive: true });
		writeFileSync(join(repoRoot, "scripts/lib/harness-inventory.mjs"), "");

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "upstream-checkout");
	});
});
