import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { collectReportEnvironment } from "../../.claude/skills/pfd-ops/scripts/collect-report-environment.mjs";

const scriptPath = fileURLToPath(
	new URL(
		"../../.claude/skills/pfd-ops/scripts/collect-report-environment.mjs",
		import.meta.url,
	),
);

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

function unavailableFields(env) {
	return env.unavailable.map(({ field }) => field).sort();
}

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
		const missingHash = env.unavailable.find(
			({ field }) => field === "bundleContentHash",
		);
		assert.ok(
			missingHash,
			"bundleContentHash should be recorded as unavailable",
		);
		assert.match(missingHash.reason, /Codex/);
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

	it("collects the CLI version and the repository commit through runCommand", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });

		const calls = [];
		const runCommand = (command, args) => {
			calls.push([command, ...args]);
			if (command === "pfdsl") return "0.4.2";
			if (command === "git") return "0123456789abcdef";
			return null;
		};

		const env = collectReportEnvironment(skillRoot, { runCommand });

		assert.equal(env.cliVersion, "0.4.2");
		assert.equal(env.repoCommit, "0123456789abcdef");
		assert.deepEqual(calls[0], ["pfdsl", "--version"]);
	});

	it("records the CLI version as unavailable when the command fails", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "0.4.2" });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.cliVersion, null);
		assert.ok(
			env.unavailable.some(({ field }) => field === "cliVersion"),
			"cliVersion should be recorded as unavailable",
		);
	});

	it("accounts for every identifier a repo-local install lacks", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		writeJson(join(repoRoot, "pfd-ops-install-manifest.json"), {
			version: "0.4.2",
		});

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.deepEqual(unavailableFields(env), [
			"bundleContentHash",
			"cliVersion",
			"pluginVersion",
			"repoCommit",
		]);
	});

	it("distinguishes an unreadable Claude manifest from a shape that has none", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(tmp, ".claude-plugin"), { recursive: true });
		writeFileSync(join(tmp, ".claude-plugin", "plugin.json"), "{ broken");

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "claude-plugin");
		assert.equal(env.pluginVersion, null);
		const failure = env.unavailable.find(
			({ field }) => field === "pluginVersion",
		);
		assert.ok(failure, "pluginVersion should be recorded as unavailable");
		assert.match(failure.reason, /could not be parsed/);
	});

	it("rejects a manifest value that parses but is not an identifier", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "" });
		writeJson(join(tmp, ".claude-plugin", "bundle-manifest.json"), {
			contentHash: 42,
		});

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.pluginVersion, null);
		assert.equal(env.bundleContentHash, null);
		assert.deepEqual(unavailableFields(env), [
			"bundleContentHash",
			"cliVersion",
			"installProvenance",
			"pluginVersion",
			"repoCommit",
		]);
	});

	it("rejects install provenance that is not an object", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		writeJson(join(repoRoot, "pfd-ops-install-manifest.json"), ["0.4.2"]);

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installProvenance, null);
		assert.ok(
			env.unavailable.some(({ field }) => field === "installProvenance"),
			"installProvenance should be recorded as unavailable",
		);
	});

	it("records a repo-local install whose provenance file is absent", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installProvenance, null);
		assert.ok(
			env.unavailable.some(({ field }) => field === "installProvenance"),
			"installProvenance should be recorded as unavailable",
		);
	});

	it("records the repository commit as unavailable when git fails", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.repoCommit, null);
		assert.ok(
			env.unavailable.some(({ field }) => field === "repoCommit"),
			"repoCommit should be recorded as unavailable",
		);
	});

	it("prints the environment as JSON when run as a command", () => {
		const result = spawnSync(process.execPath, [scriptPath], {
			encoding: "utf-8",
		});

		assert.equal(result.status, 0, result.stderr);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.installation, "upstream-checkout");
		assert.ok(Array.isArray(parsed.unavailable));
	});

	it("prints the environment when invoked through a symlink", () => {
		const link = join(tmp, "collect-report-environment.mjs");
		symlinkSync(scriptPath, link);

		const result = spawnSync(process.execPath, [link], { encoding: "utf-8" });

		assert.equal(result.status, 0, result.stderr);
		const parsed = JSON.parse(result.stdout);
		assert.equal(parsed.installation, "upstream-checkout");
	});

	it("accounts for every identifier an upstream checkout lacks", () => {
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

		assert.deepEqual(unavailableFields(env), [
			"bundleContentHash",
			"cliVersion",
			"installProvenance",
			"pluginVersion",
			"repoCommit",
		]);
	});

	it("accounts for every identifier a Claude plugin lacks", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "0.4.2" });
		writeJson(join(tmp, ".claude-plugin", "bundle-manifest.json"), {
			contentHash: "abc123",
		});

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.deepEqual(unavailableFields(env), [
			"cliVersion",
			"installProvenance",
			"repoCommit",
		]);
	});

	it("accounts for every identifier an unrecognized shape lacks", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "unknown");
		assert.deepEqual(unavailableFields(env), [
			"bundleContentHash",
			"cliVersion",
			"installProvenance",
			"pluginVersion",
			"repoCommit",
		]);
	});
});
