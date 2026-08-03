import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
	assemblePluginDistIndependent,
	buildPluginDescription,
	buildPluginManifest,
	mirrorDir,
	mirrorFiles,
	PLUGIN_AGENT_FILES,
} from "./gen-plugin.mjs";
import { collectModuleClosure, findDistDependentFiles } from "./check-script-imports.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

describe("buildPluginManifest", () => {
	it("uses the CLI version as the plugin version", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.version, "0.0.18");
	});

	it("names the plugin pfdsl", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.name, "pfdsl");
	});

	it("declares the MIT license", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.license, "MIT");
	});

	it("mentions the pfd-ops skill in the description", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.match(manifest.description, /pfd-ops/);
	});

	it("mentions the pfd-grill skill in the description", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.match(manifest.description, /pfd-grill/);
	});

	it("mentions the /pfd-retro command in the description, not just the pfd-retro skill", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.match(manifest.description, /\/pfd-retro/);
	});
});

describe("buildPluginDescription", () => {
	it("mentions every bundled skill and every bundled command", () => {
		const description = buildPluginDescription({
			skillDirs: ["pfdsl", "pfd-grill"],
			commandFiles: ["pfd-cycle.md", "pfd-retro.md"],
		});
		assert.match(description, /pfdsl skill/);
		assert.match(description, /pfd-grill skill/);
		assert.match(description, /\/pfd-cycle/);
		assert.match(description, /\/pfd-retro/);
	});

	it("throws when a bundled skill has no description blurb, instead of silently omitting it", () => {
		assert.throws(() => buildPluginDescription({ skillDirs: ["not-a-real-skill"], commandFiles: [] }), /not-a-real-skill/);
	});

	it("throws when a bundled command has no description blurb, instead of silently omitting it", () => {
		assert.throws(() => buildPluginDescription({ skillDirs: [], commandFiles: ["not-a-real-command.md"] }), /not-a-real-command\.md/);
	});
});

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "gen-plugin-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("mirrorDir", () => {
	it("copies a directory tree into the destination", () => {
		const src = join(tmp, "src", "foo");
		mkdirSync(join(src, "nested"), { recursive: true });
		writeFileSync(join(src, "a.txt"), "a");
		writeFileSync(join(src, "nested", "b.txt"), "b");
		const destRoot = join(tmp, "dest");

		mirrorDir("foo", join(tmp, "src"), destRoot);

		assert.equal(readFileSync(join(destRoot, "foo", "a.txt"), "utf-8"), "a");
		assert.equal(readFileSync(join(destRoot, "foo", "nested", "b.txt"), "utf-8"), "b");
	});

	it("removes a stale destination file that no longer exists in the source", () => {
		const src = join(tmp, "src", "foo");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "a.txt"), "a");
		const destRoot = join(tmp, "dest");
		mkdirSync(join(destRoot, "foo"), { recursive: true });
		writeFileSync(join(destRoot, "foo", "stale.txt"), "leftover from a prior run");

		mirrorDir("foo", join(tmp, "src"), destRoot);

		assert.equal(existsSync(join(destRoot, "foo", "stale.txt")), false);
		assert.equal(readFileSync(join(destRoot, "foo", "a.txt"), "utf-8"), "a");
	});

	it("exits with an error when the source directory is missing", () => {
		assert.throws(() => mirrorDir("missing", join(tmp, "src"), join(tmp, "dest")), /not found/);
	});

	it("excludes a top-level CLAUDE.md dev-only guard from the mirrored copy", () => {
		const src = join(tmp, "src", "foo");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "SKILL.md"), "skill body");
		writeFileSync(join(src, "CLAUDE.md"), "dev-only guard, never ship this");
		const destRoot = join(tmp, "dest");

		mirrorDir("foo", join(tmp, "src"), destRoot);

		assert.equal(existsSync(join(destRoot, "foo", "CLAUDE.md")), false);
		assert.equal(readFileSync(join(destRoot, "foo", "SKILL.md"), "utf-8"), "skill body");
	});

	it("keeps the prior destination content when the source copy fails partway", (t) => {
		// A source directory containing an unreadable nested file makes cpSync
		// throw partway through a recursive copy — a portable stand-in for any
		// mid-copy failure (disk full, permission change, concurrent deletion).
		// root ignores permission bits, so this fault injection can't trigger
		// there; skip rather than false-fail (#509).
		if (process.getuid?.() === 0) {
			t.skip("root ignores chmod 0o000, so this fault injection can't fail the copy");
			return;
		}
		const src = join(tmp, "src", "foo");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "a.txt"), "new-a");
		writeFileSync(join(src, "unreadable.txt"), "x");
		chmodSync(join(src, "unreadable.txt"), 0o000);

		const destRoot = join(tmp, "dest");
		mkdirSync(join(destRoot, "foo"), { recursive: true });
		writeFileSync(join(destRoot, "foo", "a.txt"), "prior-good-a");

		try {
			assert.throws(() => mirrorDir("foo", join(tmp, "src"), destRoot));
		} finally {
			chmodSync(join(src, "unreadable.txt"), 0o644);
		}

		assert.equal(readFileSync(join(destRoot, "foo", "a.txt"), "utf-8"), "prior-good-a");
	});
});

describe("mirrorFiles", () => {
	it("copies each named file into the destination", () => {
		const srcDir = join(tmp, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, "one.md"), "one");
		writeFileSync(join(srcDir, "two.md"), "two");
		const destDir = join(tmp, "dest");

		mirrorFiles(["one.md", "two.md"], srcDir, destDir);

		assert.equal(readFileSync(join(destDir, "one.md"), "utf-8"), "one");
		assert.equal(readFileSync(join(destDir, "two.md"), "utf-8"), "two");
	});

	it("removes a stale destination file no longer in the current file list", () => {
		const srcDir = join(tmp, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, "one.md"), "one");
		const destDir = join(tmp, "dest");
		mkdirSync(destDir, { recursive: true });
		writeFileSync(join(destDir, "stale.md"), "leftover from a prior run");

		mirrorFiles(["one.md"], srcDir, destDir);

		assert.equal(existsSync(join(destDir, "stale.md")), false);
		assert.equal(readFileSync(join(destDir, "one.md"), "utf-8"), "one");
	});

	it("exits with an error when a named source file is missing", () => {
		const srcDir = join(tmp, "src");
		mkdirSync(srcDir, { recursive: true });
		assert.throws(() => mirrorFiles(["missing.md"], srcDir, join(tmp, "dest")), /not found/);
	});
});

describe("assemblePluginDistIndependent", () => {
	const fakeMarketplace = {
		$schema: "https://json.schemastore.org/claude-code-marketplace.json",
		name: "pfdsl",
		description: "top-level marketplace description, distinct from the per-plugin one",
		owner: { name: "takasek" },
		plugins: [
			{
				name: "pfdsl",
				description: "stale description left behind by a prior manual edit",
				source: { source: "git-subdir", url: "https://github.com/takasek/pfdsl.git", path: "plugin/pfdsl", ref: "v0.0.1" },
			},
		],
	};

	function fakeDeps(overrides = {}) {
		const calls = [];
		return {
			calls,
			deps: {
				genInstall: (root) => calls.push(["genInstall", root]),
				mirrorDir: (name, srcRoot, destRoot) => calls.push(["mirrorDir", name, srcRoot, destRoot]),
				mirrorFiles: (names, srcDir, destDir) => calls.push(["mirrorFiles", names, srcDir, destDir]),
				writeSkillRefs: (root, outDir) => calls.push(["writeSkillRefs", root, outDir]),
				readFileSync: (path) => (String(path).endsWith("marketplace.json") ? JSON.stringify(fakeMarketplace) : JSON.stringify({ version: "1.2.3" })),
				writeFileSync: (path, content) => calls.push(["writeFileSync", path, content]),
				mkdirSync: (path) => calls.push(["mkdirSync", path]),
				...overrides,
			},
		};
	}

	it("regenerates install/ from the repo root", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({ root: "/repo", pluginRoot: "/repo/plugin/pfdsl", deps });
		assert.deepEqual(
			calls.filter((c) => c[0] === "genInstall"),
			[["genInstall", "/repo"]],
		);
	});

	it("mirrors each static skill directory and hooks into plugin/", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({ root: "/repo", pluginRoot: "/repo/plugin/pfdsl", deps });
		const mirrored = calls.filter((c) => c[0] === "mirrorDir").map((c) => c[1]);
		assert.deepEqual(mirrored.sort(), ["hooks", "pfd-ecosystem", "pfd-grill", "pfd-ops", "pfd-retro"].sort());
	});

	it("mirrors command files and bundled agent files", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({ root: "/repo", pluginRoot: "/repo/plugin/pfdsl", deps });
		const mirroredFileSets = calls.filter((c) => c[0] === "mirrorFiles").map((c) => c[1]);
		assert.deepEqual(mirroredFileSets, [["pfd-cycle.md", "pfd-init.md", "pfd-retro.md"], PLUGIN_AGENT_FILES]);
	});

	it("writes plugin.json derived from the CLI package version", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({ root: "/repo", pluginRoot: "/repo/plugin/pfdsl", deps });
		const [, path, content] = calls.find((c) => c[0] === "writeFileSync");
		assert.match(path, /\.claude-plugin\/plugin\.json$/);
		assert.equal(JSON.parse(content).version, "1.2.3");
	});

	it("writes marketplace.json's plugin description to match plugin.json's derived description", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({ root: "/repo", pluginRoot: "/repo/plugin/pfdsl", deps });
		const writes = calls.filter((c) => c[0] === "writeFileSync");
		const [, pluginJsonPath, pluginJsonContent] = writes.find(([, path]) => /\.claude-plugin\/plugin\.json$/.test(path));
		const [, marketplacePath, marketplaceContent] = writes.find(([, path]) => /\.claude-plugin\/marketplace\.json$/.test(path));
		assert.ok(pluginJsonPath, "expected a plugin.json write");
		assert.ok(marketplacePath, "expected a marketplace.json write");
		assert.equal(JSON.parse(marketplaceContent).plugins[0].description, JSON.parse(pluginJsonContent).description);
	});

	it("preserves marketplace.json's other fields when updating the description", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({ root: "/repo", pluginRoot: "/repo/plugin/pfdsl", deps });
		const [, , marketplaceContent] = calls.filter((c) => c[0] === "writeFileSync").find(([, path]) => /\.claude-plugin\/marketplace\.json$/.test(path));
		const written = JSON.parse(marketplaceContent);
		assert.equal(written.description, fakeMarketplace.description);
		assert.deepEqual(written.plugins[0].source, fakeMarketplace.plugins[0].source);
		assert.equal(written.plugins[0].name, fakeMarketplace.plugins[0].name);
	});

	it("writes skill references for the bundled pfdsl skill", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({ root: "/repo", pluginRoot: "/repo/plugin/pfdsl", deps });
		assert.deepEqual(
			calls.filter((c) => c[0] === "writeSkillRefs"),
			[["writeSkillRefs", "/repo", "/repo/plugin/pfdsl/skills/pfdsl"]],
		);
	});
});

describe("dist independence", () => {
	it("scripts/gen-plugin-dist-independent.mjs and its module closure never reference packages/cli/dist or spawn a child process", () => {
		const entry = resolve(repoRoot, "scripts/gen-plugin-dist-independent.mjs");
		const closure = collectModuleClosure(entry);

		assert.ok(closure.size >= 2, "expected the closure to include at least the entry and lib/gen-plugin.mjs");

		const violations = findDistDependentFiles([...closure]);
		assert.deepEqual(violations, [], violations.map((v) => `${v.file}: ${v.reason}`).join("; "));
	});
});
