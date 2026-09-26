import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

// The shape check-install-sync.mjs writes and reads, at the path it uses.
const PROVENANCE_RELATIVE_PATH = ".claude/pfd-ops-install-manifest.json";
const provenance = {
	files: [{ path: "scripts/pfdsl/audit-issues-flow.mjs", hash: "abc123" }],
};

function writeProvenance(repoRoot, value = provenance) {
	writeJson(join(repoRoot, PROVENANCE_RELATIVE_PATH), value);
}

function hexOf(seed) {
	return createHash("sha256").update(seed).digest("hex");
}

/** @param {{path: string, hex: string}[]} entries */
function manifestText(entries) {
	return `${entries.map(({ hex, path }) => `${hex}  ${path}`).join("\n\n")}\n`;
}

/**
 * The aggregate `computeManifestAggregateHash` in plugin-version-check.mjs
 * would compute for these entries — recomputed independently here so a test
 * asserting equality with it is not just checking that both sides call the
 * same function.
 * @param {{path: string, hex: string}[]} entries
 */
function aggregateOf(entries) {
	const digest = createHash("sha256");
	for (const { path, hex } of [...entries].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	)) {
		digest.update(path);
		digest.update("\0");
		digest.update(hex);
		digest.update("\n");
	}
	return digest.digest("hex");
}

function writeBundleManifest(bundleRoot, entries) {
	const path = join(bundleRoot, ".claude-plugin", "bundle-manifest.sha256");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, manifestText(entries));
}

describe("collectReportEnvironment", () => {
	it("reports version and bundle hash for a Claude plugin installation", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "0.4.2" });
		const entries = [{ path: "a.md", hex: hexOf("a") }];
		writeBundleManifest(tmp, entries);

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "claude-plugin");
		assert.equal(env.pluginVersion, "0.4.2");
		assert.equal(env.bundleContentHash, aggregateOf(entries));
	});

	it("reports bundleContentHash as unavailable when only the pre-#1264 bundle-manifest.json is present", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "0.4.2" });
		writeJson(join(tmp, ".claude-plugin", "bundle-manifest.json"), {
			contentHash: "abc123",
		});

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "claude-plugin");
		assert.equal(env.bundleContentHash, null);
		assert.ok(
			env.unavailable.some(({ field }) => field === "bundleContentHash"),
			"bundleContentHash should be recorded as unavailable",
		);
	});

	it("reports the Codex plugin version and records the missing bundle hash", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".codex-plugin", "plugin.json"), { version: "0.4.2" });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "codex-plugin");
		assert.equal(env.pluginVersion, "0.4.2");
		assert.equal(env.bundleContentHash, null);
		assert.deepEqual(unavailableFields(env), [
			"bundleContentHash",
			"cliVersion",
			"installProvenance",
			"repoCommit",
		]);
		const missingHash = env.unavailable.find(
			({ field }) => field === "bundleContentHash",
		);
		assert.match(missingHash.reason, /Codex/);
	});

	it("classifies a repo-local install and carries its provenance", () => {
		const repoRoot = join(tmp, "adopter");
		const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(join(repoRoot, ".git"), { recursive: true });
		writeProvenance(repoRoot);

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.installation, "repo-local");
		assert.equal(env.pluginVersion, null);
		assert.deepEqual(env.installProvenance, provenance.files);
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
		writeProvenance(repoRoot);

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

	it("rejects a manifest value that parses but is not an identifier, and a malformed bundle manifest", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "" });
		const manifestPath = join(tmp, ".claude-plugin", "bundle-manifest.sha256");
		mkdirSync(dirname(manifestPath), { recursive: true });
		writeFileSync(manifestPath, "not a manifest\n");

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

	it("rejects install provenance that holds no usable entry", () => {
		for (const invalid of [
			["0.4.2"],
			{},
			{ files: "wrong" },
			{ files: [null, {}, { path: 42, hash: [] }] },
		]) {
			const repoRoot = join(tmp, `adopter-${JSON.stringify(invalid).length}`);
			const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
			mkdirSync(skillRoot, { recursive: true });
			mkdirSync(join(repoRoot, ".git"), { recursive: true });
			writeProvenance(repoRoot, invalid);

			const env = collectReportEnvironment(skillRoot, {
				runCommand: noCommands,
			});

			assert.equal(env.installProvenance, null, JSON.stringify(invalid));
			assert.ok(
				env.unavailable.some(({ field }) => field === "installProvenance"),
				`installProvenance should be unavailable for ${JSON.stringify(invalid)}`,
			);
		}
	});

	it("rejects a manifest identifier that holds only whitespace", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });
		writeJson(join(tmp, ".claude-plugin", "plugin.json"), { version: "  " });

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.equal(env.pluginVersion, null);
		assert.ok(
			env.unavailable.some(({ field }) => field === "pluginVersion"),
			"pluginVersion should be recorded as unavailable",
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
		writeBundleManifest(tmp, [{ path: "a.md", hex: hexOf("a") }]);

		const env = collectReportEnvironment(skillRoot, { runCommand: noCommands });

		assert.deepEqual(unavailableFields(env), [
			"cliVersion",
			"installProvenance",
			"repoCommit",
		]);
	});

	it("resolves the repository root through the injected resolver", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		const elsewhere = join(tmp, "elsewhere");
		mkdirSync(skillRoot, { recursive: true });
		mkdirSync(elsewhere, { recursive: true });

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			findRepoRootOrNull: () => elsewhere,
		});

		assert.equal(env.installation, "repo-local");
	});

	it("accounts for every identifier an unrecognized shape lacks", () => {
		const skillRoot = join(tmp, "skills", "pfd-ops");
		mkdirSync(skillRoot, { recursive: true });

		// The resolver is injected rather than left to walk up from a temp
		// directory: a checkout anywhere above TMPDIR would otherwise classify
		// this fixture as repo-local and the assertion would depend on where the
		// suite happens to run.
		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			findRepoRootOrNull: () => null,
		});

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
