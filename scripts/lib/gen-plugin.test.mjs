import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	collectModuleClosure,
	findDistDependentFiles,
} from "./check-script-imports.mjs";
import {
	assembleCodexAssets,
	assemblePluginDistIndependent,
	buildPluginDescription,
	buildPluginManifest,
	codexCommandSkillName,
	mirrorDir,
	mirrorFiles,
	PLUGIN_AGENT_FILES,
} from "./gen-plugin.mjs";

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

	it("reads skill blurbs through the injected root and readFileSync, not the real filesystem", () => {
		const root = mkdtempSync(join(tmpdir(), "gen-plugin-manifest-"));
		try {
			const skillDir = join(root, ".claude/skills/pfd-ops");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, "SKILL.md"),
				"---\nname: pfd-ops\nsummary: injected-root blurb\ndescription: |\n  long form\n---\nbody\n",
			);
			const pfdslDir = join(root, "scripts/skill-template");
			mkdirSync(pfdslDir, { recursive: true });
			writeFileSync(
				join(pfdslDir, "SKILL.md"),
				"---\nname: pfdsl\nsummary: injected-root pfdsl blurb\ndescription: |\n  long form\n---\nbody\n",
			);

			const manifest = buildPluginManifest({
				cliVersion: "0.0.18",
				root,
				skillDirs: ["pfdsl", "pfd-ops"],
				commandFiles: [],
			});

			assert.match(manifest.description, /injected-root blurb/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
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
		assert.throws(
			() =>
				buildPluginDescription({
					skillDirs: ["not-a-real-skill"],
					commandFiles: [],
				}),
			/not-a-real-skill/,
		);
	});

	it("derives a command's blurb from its filename, so no table can drift from PLUGIN_COMMAND_FILES", () => {
		const description = buildPluginDescription({
			skillDirs: [],
			commandFiles: ["brand-new-command.md"],
		});
		assert.match(description, /\/brand-new-command\b/);
	});

	it("reads a skill's blurb from its SKILL.md summary frontmatter field, not a hand-maintained table", () => {
		const root = mkdtempSync(join(tmpdir(), "gen-plugin-desc-"));
		try {
			const skillDir = join(root, ".claude/skills/pfd-ops");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, "SKILL.md"),
				"---\nname: pfd-ops\nsummary: a totally new blurb never in any table\ndescription: |\n  long form\n---\nbody\n",
			);

			const description = buildPluginDescription({
				skillDirs: ["pfd-ops"],
				commandFiles: [],
				root,
			});

			assert.match(description, /a totally new blurb never in any table/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("throws naming the missing frontmatter field when a bundled skill's SKILL.md has no summary", () => {
		const root = mkdtempSync(join(tmpdir(), "gen-plugin-desc-"));
		try {
			const skillDir = join(root, ".claude/skills/pfd-ops");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, "SKILL.md"),
				"---\nname: pfd-ops\ndescription: |\n  long form\n---\nbody\n",
			);

			assert.throws(
				() =>
					buildPluginDescription({
						skillDirs: ["pfd-ops"],
						commandFiles: [],
						root,
					}),
				/summary/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
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
		assert.equal(
			readFileSync(join(destRoot, "foo", "nested", "b.txt"), "utf-8"),
			"b",
		);
	});

	it("removes a stale destination file that no longer exists in the source", () => {
		const src = join(tmp, "src", "foo");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "a.txt"), "a");
		const destRoot = join(tmp, "dest");
		mkdirSync(join(destRoot, "foo"), { recursive: true });
		writeFileSync(
			join(destRoot, "foo", "stale.txt"),
			"leftover from a prior run",
		);

		mirrorDir("foo", join(tmp, "src"), destRoot);

		assert.equal(existsSync(join(destRoot, "foo", "stale.txt")), false);
		assert.equal(readFileSync(join(destRoot, "foo", "a.txt"), "utf-8"), "a");
	});

	it("exits with an error when the source directory is missing", () => {
		assert.throws(
			() => mirrorDir("missing", join(tmp, "src"), join(tmp, "dest")),
			/not found/,
		);
	});

	it("excludes a top-level CLAUDE.md dev-only guard from the mirrored copy", () => {
		const src = join(tmp, "src", "foo");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "SKILL.md"), "skill body");
		writeFileSync(join(src, "CLAUDE.md"), "dev-only guard, never ship this");
		const destRoot = join(tmp, "dest");

		mirrorDir("foo", join(tmp, "src"), destRoot);

		assert.equal(existsSync(join(destRoot, "foo", "CLAUDE.md")), false);
		assert.equal(
			readFileSync(join(destRoot, "foo", "SKILL.md"), "utf-8"),
			"skill body",
		);
	});

	it("keeps the prior destination content when the source copy fails partway", (t) => {
		// A source directory containing an unreadable nested file makes cpSync
		// throw partway through a recursive copy — a portable stand-in for any
		// mid-copy failure (disk full, permission change, concurrent deletion).
		// root ignores permission bits, so this fault injection can't trigger
		// there; skip rather than false-fail (#509).
		if (process.getuid?.() === 0) {
			t.skip(
				"root ignores chmod 0o000, so this fault injection can't fail the copy",
			);
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

		assert.equal(
			readFileSync(join(destRoot, "foo", "a.txt"), "utf-8"),
			"prior-good-a",
		);
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
		assert.throws(
			() => mirrorFiles(["missing.md"], srcDir, join(tmp, "dest")),
			/not found/,
		);
	});
});

describe("assemblePluginDistIndependent", () => {
	const fakeMarketplace = {
		$schema: "https://json.schemastore.org/claude-code-marketplace.json",
		name: "pfdsl",
		description:
			"top-level marketplace description, distinct from the per-plugin one",
		owner: { name: "takasek" },
		plugins: [
			{
				name: "pfdsl",
				description: "stale description left behind by a prior manual edit",
				source: {
					source: "git-subdir",
					url: "https://github.com/takasek/pfdsl.git",
					path: "plugin/pfdsl",
					ref: "v0.0.1",
				},
			},
		],
	};

	function fakeDeps(overrides = {}) {
		const calls = [];
		return {
			calls,
			deps: {
				genInstall: (root) => calls.push(["genInstall", root]),
				mirrorDir: (name, srcRoot, destRoot) =>
					calls.push(["mirrorDir", name, srcRoot, destRoot]),
				mirrorFiles: (names, srcDir, destDir) =>
					calls.push(["mirrorFiles", names, srcDir, destDir]),
				writeSkillRefs: (root, outDir) =>
					calls.push(["writeSkillRefs", root, outDir]),
				readFileSync: (path) =>
					String(path).endsWith("marketplace.json")
						? JSON.stringify(fakeMarketplace)
						: JSON.stringify({ version: "1.2.3" }),
				writeFileSync: (path, content) =>
					calls.push(["writeFileSync", path, content]),
				mkdirSync: (path) => calls.push(["mkdirSync", path]),
				writeBundleManifest: (bundleRoot) =>
					calls.push(["writeBundleManifest", bundleRoot]),
				assembleCodexAssets: (options) =>
					calls.push(["assembleCodexAssets", options]),
				...overrides,
			},
		};
	}

	it("regenerates install/ from the repo root", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		assert.deepEqual(
			calls.filter((c) => c[0] === "genInstall"),
			[["genInstall", "/repo"]],
		);
	});

	it("mirrors each static skill directory and hooks into plugin/", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		const mirrored = calls.filter((c) => c[0] === "mirrorDir").map((c) => c[1]);
		assert.deepEqual(
			mirrored.sort(),
			["hooks", "pfd-ecosystem", "pfd-grill", "pfd-ops", "pfd-retro"].sort(),
		);
	});

	it("mirrors command files and bundled agent files", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		const mirroredFileSets = calls
			.filter((c) => c[0] === "mirrorFiles")
			.map((c) => c[1]);
		assert.deepEqual(mirroredFileSets, [
			["pfd-cycle.md", "pfd-init.md", "pfd-retro.md"],
			PLUGIN_AGENT_FILES,
		]);
	});

	it("writes plugin.json derived from the CLI package version", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		const [, path, content] = calls.find((c) => c[0] === "writeFileSync");
		assert.match(path, /\.claude-plugin\/plugin\.json$/);
		assert.equal(JSON.parse(content).version, "1.2.3");
	});

	it("writes marketplace.json's plugin description to match plugin.json's derived description", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		const writes = calls.filter((c) => c[0] === "writeFileSync");
		const [, pluginJsonPath, pluginJsonContent] = writes.find(([, path]) =>
			/\.claude-plugin\/plugin\.json$/.test(path),
		);
		const [, marketplacePath, marketplaceContent] = writes.find(([, path]) =>
			/\.claude-plugin\/marketplace\.json$/.test(path),
		);
		assert.ok(pluginJsonPath, "expected a plugin.json write");
		assert.ok(marketplacePath, "expected a marketplace.json write");
		assert.equal(
			JSON.parse(marketplaceContent).plugins[0].description,
			JSON.parse(pluginJsonContent).description,
		);
	});

	it("preserves marketplace.json's other fields when updating the description", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		const [, , marketplaceContent] = calls
			.filter((c) => c[0] === "writeFileSync")
			.find(([, path]) => /\.claude-plugin\/marketplace\.json$/.test(path));
		const written = JSON.parse(marketplaceContent);
		assert.equal(written.description, fakeMarketplace.description);
		assert.deepEqual(
			written.plugins[0].source,
			fakeMarketplace.plugins[0].source,
		);
		assert.equal(written.plugins[0].name, fakeMarketplace.plugins[0].name);
	});

	it("writes skill references for the bundled pfdsl skill", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		assert.deepEqual(
			calls.filter((c) => c[0] === "writeSkillRefs"),
			[["writeSkillRefs", "/repo", "/repo/plugin/pfdsl/skills/pfdsl"]],
		);
	});

	it("assembles Codex assets after the Claude plugin output", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		const codex = calls.findIndex((call) => call[0] === "assembleCodexAssets");
		const refs = calls.findIndex((call) => call[0] === "writeSkillRefs");
		assert.ok(codex > refs);
		assert.deepEqual(calls[codex][1], {
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
	});

	it("records the bundle content hash last, after every other bundled file is final", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		// Last, not merely present: the hash covers the bundle's own files, so a
		// write that lands after it (writeSkillRefs was the previous final step)
		// leaves the recorded value describing a bundle that no longer exists.
		assert.deepEqual(calls.at(-1), [
			"writeBundleManifest",
			"/repo/plugin/pfdsl",
		]);
	});
});

describe("assembleCodexAssets", () => {
	it("keeps non-colliding command names and prefixes names that collide with distributed skills", () => {
		assert.equal(codexCommandSkillName("pfd-cycle.md"), "pfd-cycle");
		assert.equal(
			codexCommandSkillName("pfd-retro.md"),
			"source-command-pfd-retro",
		);
	});

	function fakeCodexDeps(overrides = {}) {
		const calls = [];
		const skillSource =
			"---\nname: skill\nsummary: generated skill\ndescription: |\n  generated skill\n---\nbody\n";
		return {
			calls,
			deps: {
				cpSync: (source, destination, options) =>
					calls.push(["cpSync", source, destination, options]),
				existsSync: () => false,
				mkdirSync: (path) => calls.push(["mkdirSync", path]),
				newRunId: () => "test-run",
				readFileSync: (path) => {
					const normalized = String(path);
					if (normalized.endsWith("CLAUDE.md")) return "Read CLAUDE.md.\n";
					if (normalized.endsWith("settings.json"))
						return JSON.stringify({ hooks: { PreToolUse: [] } });
					if (normalized.endsWith("package.json"))
						return JSON.stringify({ version: "1.2.3" });
					if (normalized.endsWith(".md") && normalized.includes("commands"))
						return "---\ndescription: generated command\n---\n\ncommand body\n";
					if (normalized.endsWith(".md") && normalized.includes("agents"))
						return "---\nname: generated\ndescription: generated agent\ntools: Read, Grep, Bash\nmodel: sonnet\n---\n\nRead CLAUDE.md.\n";
					return skillSource;
				},
				renameSync: (from, to) => calls.push(["renameSync", from, to]),
				rmSync: (path) => calls.push(["rmSync", path]),
				writeFileSync: (path, content) =>
					calls.push(["writeFileSync", path, content]),
				...overrides,
			},
		};
	}

	function statefulCodexDeps({ failRemove, failWrite, failPublish } = {}) {
		const { calls, deps: sourceDeps } = fakeCodexDeps();
		const files = new Map();
		const destinations = [
			"/repo/AGENTS.md",
			"/repo/.codex/hooks.json",
			"/repo/plugin/pfdsl/.codex-plugin/plugin.json",
			"/repo/.agents/skills",
			"/repo/.codex/agents",
			"/repo/plugin/pfdsl/skills/pfd-cycle",
			"/repo/plugin/pfdsl/skills/pfd-init",
			"/repo/plugin/pfdsl/skills/source-command-pfd-retro",
		];
		for (const destination of destinations) {
			files.set(destination, "directory");
			files.set(`${destination}/prior.txt`, `prior ${destination}`);
		}
		const before = new Map(files);
		let publishCount = 0;

		const remove = (path) => {
			for (const existing of [...files.keys()]) {
				if (existing === path || existing.startsWith(`${path}/`)) {
					files.delete(existing);
				}
			}
		};
		const move = (from, to) => {
			const moving = [...files.entries()].filter(
				([path]) => path === from || path.startsWith(`${from}/`),
			);
			remove(to);
			for (const [path, content] of moving) {
				files.delete(path);
				files.set(`${to}${path.slice(from.length)}`, content);
			}
		};

		return {
			calls,
			before,
			files,
			deps: {
				...sourceDeps,
				cpSync: (source, destination, options) => {
					calls.push(["cpSync", source, destination, options]);
					files.set(destination, "directory");
				},
				existsSync: (path) => files.has(path),
				mkdirSync: (path) => {
					calls.push(["mkdirSync", path]);
					files.set(path, "directory");
				},
				rmSync: (path) => {
					calls.push(["rmSync", path]);
					if (failRemove?.(path)) throw new Error("cleanup failed");
					remove(path);
				},
				readFileSync: (path) => {
					if (files.has(path) && typeof files.get(path) === "string") {
						return files.get(path);
					}
					return sourceDeps.readFileSync(path);
				},
				newRunId: () => "stateful-run",
				writeFileSync: (path, content) => {
					calls.push(["writeFileSync", path, content]);
					files.set(path, content);
					if (failWrite?.(path)) throw new Error("staging write failed");
				},
				renameSync: (from, to) => {
					calls.push(["renameSync", from, to]);
					if (from.includes(".codex-tmp")) {
						publishCount += 1;
						if (failPublish?.(publishCount, from, to)) {
							throw new Error("publication rename failed");
						}
					}
					move(from, to);
				},
			},
		};
	}

	function assertNoAssemblyArtifacts(files) {
		assert.equal(
			[...files.keys()].some(
				(path) => path.includes(".codex-tmp") || path.includes(".codex-prev"),
			),
			false,
		);
	}

	function assertPriorDestinationsRestored(files, before) {
		for (const [path, content] of before) {
			assert.equal(files.get(path), content, path);
		}
	}

	it("uses a unique staging sibling for each assembly run", () => {
		const { calls, deps } = fakeCodexDeps({
			newRunId: () => "unique-run",
		});
		assembleCodexAssets({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});

		assert.equal(
			calls.some(
				([kind, path]) =>
					kind === "writeFileSync" &&
					String(path).includes(".codex-tmp-unique-run"),
			),
			true,
		);
	});

	it("rejects a concurrent assembly before it can publish a destination", () => {
		const { calls, deps } = fakeCodexDeps();
		const originalMkdir = deps.mkdirSync;
		const originalRemove = deps.rmSync;
		const originalRename = deps.renameSync;
		const originalWrite = deps.writeFileSync;
		let lockHeld = false;
		let reentrant = false;
		let reentrantPublish = false;
		let attempted = false;

		deps.mkdirSync = (path, ...args) => {
			if (String(path).endsWith(".codex-assets-assembly.lock")) {
				if (lockHeld) {
					const error = new Error("assembly lock is held");
					error.code = "EEXIST";
					throw error;
				}
				lockHeld = true;
			}
			return originalMkdir(path, ...args);
		};
		deps.rmSync = (path, ...args) => {
			if (String(path).endsWith(".codex-assets-assembly.lock")) {
				lockHeld = false;
			}
			return originalRemove(path, ...args);
		};
		deps.renameSync = (from, to) => {
			if (reentrant) reentrantPublish = true;
			return originalRename(from, to);
		};
		deps.writeFileSync = (path, content) => {
			originalWrite(path, content);
			if (attempted) return;
			attempted = true;
			reentrant = true;
			assert.throws(
				() =>
					assembleCodexAssets({
						root: "/repo",
						pluginRoot: "/repo/plugin/pfdsl",
						deps,
					}),
				/assembly lock/,
			);
			reentrant = false;
		};

		assembleCodexAssets({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});

		assert.equal(reentrantPublish, false);
		assert.equal(lockHeld, false);
		assert.ok(
			calls.some(
				([kind, path]) =>
					kind === "mkdirSync" &&
					String(path).endsWith(".codex-assets-assembly.lock"),
			),
		);
	});

	it("removes stale owned command skills while preserving a new collision target", () => {
		const { deps, files } = statefulCodexDeps();
		const skillsRoot = "/repo/plugin/pfdsl/skills";
		const manifestPath =
			"/repo/plugin/pfdsl/.codex-plugin/codex-command-skills.json";
		files.set(
			manifestPath,
			JSON.stringify({
				ownedSkillDirectories: ["removed-command", "pfd-retro"],
			}),
		);
		files.set(`${skillsRoot}/removed-command`, "directory");
		files.set(`${skillsRoot}/removed-command/SKILL.md`, "obsolete command");
		files.set(`${skillsRoot}/pfd-retro`, "directory");
		files.set(`${skillsRoot}/pfd-retro/SKILL.md`, "mirrored pfd-retro skill");

		assembleCodexAssets({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});

		assert.equal(files.has(`${skillsRoot}/removed-command`), false);
		assert.equal(
			files.get(`${skillsRoot}/pfd-retro/SKILL.md`),
			"mirrored pfd-retro skill",
		);
		assert.deepEqual(JSON.parse(files.get(manifestPath)), {
			ownedSkillDirectories: [
				"pfd-cycle",
				"pfd-init",
				"source-command-pfd-retro",
			],
		});
	});

	it("fails closed when a prior command ownership manifest is malformed", () => {
		const { deps, files } = statefulCodexDeps();
		const manifestPath =
			"/repo/plugin/pfdsl/.codex-plugin/codex-command-skills.json";
		files.set(manifestPath, "{}");

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/codex-command-skills\.json: invalid Codex command skill ownership manifest/,
		);
		assert.equal(files.get(manifestPath), "{}");
		assertNoAssemblyArtifacts(files);
	});

	it("releases its assembly lock after staging fails", () => {
		const { deps } = statefulCodexDeps({
			failWrite: (path) => path.includes("pfd-init"),
		});
		let lockHeld = false;
		const originalMkdir = deps.mkdirSync;
		const originalRemove = deps.rmSync;
		deps.mkdirSync = (path, ...args) => {
			if (String(path).endsWith(".codex-assets-assembly.lock")) lockHeld = true;
			return originalMkdir(path, ...args);
		};
		deps.rmSync = (path, ...args) => {
			if (String(path).endsWith(".codex-assets-assembly.lock"))
				lockHeld = false;
			return originalRemove(path, ...args);
		};

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/staging write failed/,
		);
		assert.equal(lockHeld, false);
	});

	it("surfaces a lock-release error after successful publication", () => {
		const { deps } = statefulCodexDeps({
			failRemove: (path) =>
				String(path).endsWith(".codex-assets-assembly.lock"),
		});

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/cleanup failed/,
		);
	});

	it("keeps a staging error when lock release also fails", () => {
		const { deps } = statefulCodexDeps({
			failRemove: (path) =>
				String(path).endsWith(".codex-assets-assembly.lock"),
			failWrite: (path) => path.includes("pfd-init"),
		});

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/staging write failed/,
		);
	});

	it("stages and atomically publishes every Codex output", () => {
		const { calls, deps } = fakeCodexDeps();
		assembleCodexAssets({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});

		const published = calls
			.filter(([kind]) => kind === "renameSync")
			.map(([, , to]) => to);
		assert.deepEqual(
			published.sort(),
			[
				"/repo/AGENTS.md",
				"/repo/.agents/skills",
				"/repo/.codex/agents",
				"/repo/.codex/hooks.json",
				"/repo/plugin/pfdsl/.codex-plugin/codex-command-skills.json",
				"/repo/plugin/pfdsl/.codex-plugin/plugin.json",
				"/repo/plugin/pfdsl/skills/pfd-cycle",
				"/repo/plugin/pfdsl/skills/pfd-init",
				"/repo/plugin/pfdsl/skills/source-command-pfd-retro",
			].sort(),
		);

		const staged = calls.filter(([kind]) => kind === "writeFileSync");
		assert.equal(
			staged.some(([, path]) =>
				path.includes(".agents/skills.codex-tmp-test-run/pfd-grill/SKILL.md"),
			),
			true,
		);
		assert.equal(
			staged.some(([, path]) =>
				path.includes(".agents/skills.codex-tmp-test-run/pfd-ops/SKILL.md"),
			),
			true,
		);
		assert.equal(
			staged.some(([, path]) =>
				path.includes(".codex/agents.codex-tmp-test-run/pfd-lens.toml"),
			),
			true,
		);
		assert.equal(
			staged.some(([, path]) =>
				path.includes(".codex/agents.codex-tmp-test-run/pfd-implementer.toml"),
			),
			true,
		);
		assert.equal(
			staged.some(([, path]) =>
				path.includes(
					"skills/source-command-pfd-retro.codex-tmp-test-run/SKILL.md",
				),
			),
			true,
		);

		const [, , manifest] = staged.find(([, path]) =>
			path.endsWith(".codex-plugin/plugin.json.codex-tmp-test-run"),
		);
		assert.equal(Object.hasOwn(JSON.parse(manifest), "hooks"), false);
		const [, , ownership] = staged.find(([, path]) =>
			path.endsWith(
				".codex-plugin/codex-command-skills.json.codex-tmp-test-run",
			),
		);
		assert.deepEqual(JSON.parse(ownership), {
			ownedSkillDirectories: [
				"pfd-cycle",
				"pfd-init",
				"source-command-pfd-retro",
			],
		});
	});

	it("leaves stale destinations untouched when staging a Codex output fails", () => {
		const { calls, deps } = fakeCodexDeps({
			writeFileSync: (path, content) => {
				calls.push(["writeFileSync", path, content]);
				if (String(path).includes("pfd-init")) throw new Error("write failed");
			},
		});

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/write failed/,
		);
		assert.deepEqual(
			calls.filter(([kind]) => kind === "renameSync"),
			[],
		);
	});

	it("removes every staged sibling and keeps prior destinations when staging fails midway", () => {
		const { before, deps, files } = statefulCodexDeps({
			failWrite: (path) => path.includes("pfd-init.codex-tmp"),
		});

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/staging write failed/,
		);
		assertPriorDestinationsRestored(files, before);
		assertNoAssemblyArtifacts(files);
	});

	it("restores every prior destination and removes staging siblings when publication fails", () => {
		const { before, deps, files } = statefulCodexDeps({
			failPublish: (count) => count === 2,
		});

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/publication rename failed/,
		);
		assertPriorDestinationsRestored(files, before);
		assertNoAssemblyArtifacts(files);
	});

	it("keeps the publication error when rollback cleanup also fails", () => {
		const { deps } = statefulCodexDeps({
			failPublish: (count) => count === 2,
			failRemove: (path) => path === "/repo/AGENTS.md",
		});

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/publication rename failed/,
		);
	});
});

describe("Codex generated consumers", () => {
	it("mirrors complete skills and lets a .agents-only consumer run the pfd-ops self-check", () => {
		const pluginRoot = join(repoRoot, "plugin/pfdsl");
		assemblePluginDistIndependent({ root: repoRoot, pluginRoot });

		const consumer = mkdtempSync(join(tmpdir(), "codex-agents-consumer-"));
		try {
			cpSync(join(repoRoot, ".agents"), join(consumer, ".agents"), {
				recursive: true,
			});
			assert.equal(existsSync(join(consumer, ".claude")), false);
			assert.equal(
				readFileSync(
					join(
						consumer,
						".agents/skills/pfd-ops/scripts/check-install-sync.mjs",
					),
					"utf-8",
				),
				readFileSync(
					join(
						repoRoot,
						".claude/skills/pfd-ops/scripts/check-install-sync.mjs",
					),
					"utf-8",
				),
			);
			assert.equal(
				readFileSync(
					join(consumer, ".agents/skills/pfd-ops/references/work-cycle.md"),
					"utf-8",
				),
				readFileSync(
					join(repoRoot, ".claude/skills/pfd-ops/references/work-cycle.md"),
					"utf-8",
				),
			);
			assert.equal(
				existsSync(
					join(consumer, ".agents/skills/pfdsl/references/quality-guide.md"),
				),
				true,
			);
			const sourcePfdslSpec = readFileSync(
				join(pluginRoot, "skills/pfdsl/references/spec.md"),
				"utf-8",
			);
			assert.equal(
				readFileSync(
					join(consumer, ".agents/skills/pfdsl/references/spec.md"),
					"utf-8",
				),
				sourcePfdslSpec.replace(/\n+$/, "\n"),
				"Codex copies preserve reference content while canonicalizing only EOF blank lines",
			);

			const output = execFileSync(
				process.execPath,
				[
					join(
						consumer,
						".agents/skills/pfd-ops/scripts/check-install-sync.mjs",
					),
				],
				{ cwd: consumer, encoding: "utf-8" },
			);
			assert.match(output, /not adopted/);
		} finally {
			rmSync(consumer, { recursive: true, force: true });
		}
	});

	it("runs the generated plugin hook through Codex's compatibility environment", () => {
		const pluginRoot = join(repoRoot, "plugin/pfdsl");
		assemblePluginDistIndependent({ root: repoRoot, pluginRoot });

		const consumer = mkdtempSync(join(tmpdir(), "codex-hook-consumer-"));
		try {
			const pluginCopy = join(consumer, "plugin-cache/pfdsl");
			cpSync(pluginRoot, pluginCopy, { recursive: true });
			assert.equal(existsSync(join(consumer, ".claude")), false);

			const roadmap = join(consumer, ".pfdsl/roadmap.pfdsl");
			mkdirSync(dirname(roadmap), { recursive: true });
			writeFileSync(roadmap, "artifact:\n  delivery:\n    status: wip\n");
			execFileSync("git", ["init", "-q"], { cwd: consumer });
			execFileSync("git", ["add", ".pfdsl/roadmap.pfdsl"], { cwd: consumer });
			execFileSync(
				"git",
				[
					"-c",
					"user.name=Codex Test",
					"-c",
					"user.email=codex-test@example.invalid",
					"commit",
					"-qm",
					"baseline",
				],
				{ cwd: consumer },
			);
			writeFileSync(roadmap, "artifact:\n  delivery:\n    status: done\n");
			execFileSync("git", ["add", ".pfdsl/roadmap.pfdsl"], { cwd: consumer });
			execFileSync(
				"git",
				[
					"-c",
					"user.name=Codex Test",
					"-c",
					"user.email=codex-test@example.invalid",
					"commit",
					"-qm",
					"mark delivery done",
				],
				{ cwd: consumer },
			);

			const hookConfig = JSON.parse(
				readFileSync(join(pluginCopy, "hooks/hooks.json"), "utf-8"),
			);
			const command = hookConfig.hooks.PostToolUse[0].hooks[0].command;
			const output = execFileSync("/bin/sh", ["-c", command], {
				cwd: consumer,
				encoding: "utf-8",
				env: { ...process.env, CLAUDE_PLUGIN_ROOT: pluginCopy },
				input: JSON.stringify({
					cwd: consumer,
					tool_input: { command: "git commit -m mark-delivery-done" },
				}),
			});
			assert.deepEqual(JSON.parse(output), {
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
					additionalContext:
						"note: this commit marks a roadmap artifact done — run pfd-retro if warranted.",
				},
			});
		} finally {
			rmSync(consumer, { recursive: true, force: true });
		}
	});
});

describe("dist independence", () => {
	it("scripts/gen-plugin-dist-independent.mjs and its module closure never reference packages/cli/dist or spawn a child process", () => {
		const entry = resolve(repoRoot, "scripts/gen-plugin-dist-independent.mjs");
		const closure = collectModuleClosure(entry);

		assert.ok(
			closure.size >= 2,
			"expected the closure to include at least the entry and lib/gen-plugin.mjs",
		);

		const violations = findDistDependentFiles([...closure]);
		assert.deepEqual(
			violations,
			[],
			violations.map((v) => `${v.file}: ${v.reason}`).join("; "),
		);
	});
});
