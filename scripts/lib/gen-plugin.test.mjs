import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
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
	claudeInstructionsToAgents,
	commandCapabilityToCodexSkill,
	generatedMarkdownNoticeCount,
	generatedSourceCommentCount,
} from "./gen-codex-assets.mjs";
import {
	assembleClaudeAssets,
	assembleCodexAssets,
	assemblePluginDistIndependent,
	buildPluginDescription,
	buildPluginManifest,
	codexCommandSkillName,
	mirrorDir,
	mirrorFiles,
	PLUGIN_AGENT_FILES,
} from "./gen-plugin.mjs";
import {
	assertTargetOutputClosure as assertOutputClosure,
	capabilitiesForTarget,
	validateCapabilityContract,
} from "./harness-capability-contract.mjs";
import {
	PROBE_FIXTURES,
	runTargetConsumerProbe,
} from "./harness-capability-probes.test-helper.mjs";
import { GENERATED_SKILLS } from "./harness-inventory.mjs";
import { decodeHarnessSources } from "./harness-source-decoder.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");
const hookHostEnvironment = { PATH: process.env.PATH };
const decodedHarnessCapabilities = validateCapabilityContract(
	decodeHarnessSources({ root: repoRoot }),
	{
		probeKinds: PROBE_FIXTURES,
	},
);

function pluginMetadataRecord(version = "0.0.18") {
	return {
		source: { path: "packages/cli/package.json" },
		semantic: {
			version,
			identity: {
				name: "pfdsl",
				author: { name: "takasek" },
				homepage: "https://github.com/takasek/pfdsl",
				license: "MIT",
			},
		},
	};
}

function targetOutputEntries(capabilities, target) {
	return capabilitiesForTarget(capabilities, target).flatMap(
		({ id, mapping }) =>
			mapping.disposition === "intentional-exclusion"
				? []
				: mapping.outputs.map((surface) => ({ surface, capabilityId: id })),
	);
}

function markdownFiles(directory, relative = "") {
	return readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name))
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			const entryRelative = join(relative, entry.name);
			if (entry.isDirectory()) return markdownFiles(path, entryRelative);
			return entry.isFile() && entry.name.endsWith(".md")
				? [entryRelative]
				: [];
		});
}

function treeFiles(directory, relative = "") {
	return readdirSync(directory, { withFileTypes: true })
		.sort((left, right) => left.name.localeCompare(right.name))
		.flatMap((entry) => {
			const path = join(directory, entry.name);
			const entryRelative = join(relative, entry.name);
			if (entry.isDirectory()) return treeFiles(path, entryRelative);
			return entry.isFile() ? [entryRelative] : [];
		});
}

function codexMarkdownSource(root, relativePath) {
	const [skillName, ...path] = relativePath.split("/");
	const generated = GENERATED_SKILLS[skillName];
	const generatedRoot = generated && join(root, generated.target);
	const skillRoot =
		generatedRoot && existsSync(generatedRoot)
			? generatedRoot
			: generated
				? join(root, "plugin/pfdsl/skills", skillName)
				: join(root, ".claude/skills", skillName);
	return join(skillRoot, ...path);
}

function expectedCodexMarkdown(source) {
	return claudeInstructionsToAgents(source).replace(/(?:\r?\n){2,}$/, "\n");
}

function removeGeneratedMarkdownNotice(source) {
	return source
		.replace(
			/^(---\r?\n[\s\S]*?\r?\n---\r?\n)<!-- DO NOT EDIT\. Authoritative source: .*? -->\r?\n\r?\n/,
			"$1\n",
		)
		.replace(/^<!-- DO NOT EDIT\. Authoritative source: .*? -->\r?\n\r?\n/, "");
}

function removeGeneratedSourceComment(source) {
	return source.replace(
		/^(#![^\r\n]*\r?\n)?\/\/ DO NOT EDIT\. Authoritative source: .*?\.\r?\n/,
		"$1",
	);
}

describe("buildPluginManifest", () => {
	it("uses decoded plugin metadata as the plugin version", () => {
		const manifest = buildPluginManifest({ record: pluginMetadataRecord() });
		assert.equal(manifest.version, "0.0.18");
	});

	it("names the plugin pfdsl", () => {
		const manifest = buildPluginManifest({ record: pluginMetadataRecord() });
		assert.equal(manifest.name, "pfdsl");
	});

	it("declares the MIT license", () => {
		const manifest = buildPluginManifest({ record: pluginMetadataRecord() });
		assert.equal(manifest.license, "MIT");
	});

	it("mentions the pfd-ops skill in the description", () => {
		const manifest = buildPluginManifest({ record: pluginMetadataRecord() });
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
				record: pluginMetadataRecord(),
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
		const manifest = buildPluginManifest({ record: pluginMetadataRecord() });
		assert.match(manifest.description, /pfd-grill/);
	});

	it("mentions the /pfd-retro command in the description, not just the pfd-retro skill", () => {
		const manifest = buildPluginManifest({ record: pluginMetadataRecord() });
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
				cpSync: () => {},
				decodeHarnessCapabilities: () => decodedHarnessCapabilities,
				existsSync: () => false,
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
						: "---\nsummary: generated skill\n---\nbody\n",
				writeFileSync: (path, content) =>
					calls.push(["writeFileSync", path, content]),
				mkdirSync: (path) => calls.push(["mkdirSync", path]),
				writeBundleManifest: (bundleRoot) =>
					calls.push(["writeBundleManifest", bundleRoot]),
				newRunId: () => "fake-run",
				renameSync: () => {},
				rmSync: () => {},
				assembleCodexAssets: (options) => {
					calls.push(["assembleCodexAssets", options]);
					return {
						observed: {
							"codex-repository": targetOutputEntries(
								decodedHarnessCapabilities,
								"codex-repository",
							),
							"codex-plugin": targetOutputEntries(
								decodedHarnessCapabilities,
								"codex-plugin",
							),
						},
					};
				},
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
			[
				"hooks",
				"pfd-ecosystem",
				"pfd-grill",
				"pfd-ops",
				"pfd-retro",
				"pfdsl",
			].sort(),
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

	it("writes plugin.json from decoded plugin metadata", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		const [, path, content] = calls.find((c) => c[0] === "writeFileSync");
		assert.match(path, /\.claude-plugin\/plugin\.json$/);
		assert.equal(
			JSON.parse(content).version,
			decodedHarnessCapabilities.find(
				(record) => record.id === "plugin-metadata",
			).semantic.version,
		);
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
			[["writeSkillRefs", "/repo", "/repo/generated/skills/pfdsl"]],
		);
	});

	it("passes one decoded capability record set to sibling adapters", () => {
		const capabilities = Object.freeze([]);
		const { calls, deps } = fakeDeps({
			decodeHarnessCapabilities: () => {
				calls.push(["decodeHarnessCapabilities"]);
				return capabilities;
			},
			assembleClaudeAssets: (options) => {
				calls.push(["assembleClaudeAssets", options]);
				return {
					observed: {
						"claude-repository": [],
						"claude-plugin": [],
					},
				};
			},
			assembleCodexAssets: (options) => {
				calls.push(["assembleCodexAssets", options]);
				return {
					observed: {
						"codex-repository": [],
						"codex-plugin": [],
					},
				};
			},
			assertTargetOutputClosure: (options) => {
				calls.push(["assertTargetOutputClosure", options.target]);
				return assertOutputClosure(options);
			},
		});
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		assert.equal(
			calls.filter(([kind]) => kind === "decodeHarnessCapabilities").length,
			1,
		);
		const claude = calls.find(([kind]) => kind === "assembleClaudeAssets");
		const codex = calls.find(([kind]) => kind === "assembleCodexAssets");
		assert.equal(claude[1].capabilities, capabilities);
		assert.equal(codex[1].capabilities, capabilities);
		assert.equal(Object.hasOwn(codex[1], "pluginRoot"), false);
		assert.equal(Object.hasOwn(codex[1], "claudeManifest"), false);
		const firstClosure = calls.findIndex(
			([kind]) => kind === "assertTargetOutputClosure",
		);
		assert.ok(firstClosure > calls.indexOf(codex));
		assert.deepEqual(
			calls
				.slice(firstClosure)
				.filter(([kind]) => kind === "assertTargetOutputClosure")
				.map(([, target]) => target),
			[
				"claude-repository",
				"claude-plugin",
				"codex-repository",
				"codex-plugin",
			],
		);
	});

	it("rejects an output-closure violation for every delivery target", () => {
		const capabilities = [
			{
				id: "capability:test",
				mappings: Object.fromEntries(
					[
						"claude-repository",
						"claude-plugin",
						"codex-repository",
						"codex-plugin",
					].map((target) => [
						target,
						{
							disposition: "transform",
							outputs: [`surface:${target}`],
						},
					]),
				),
			},
		];
		const fixtures = [
			{
				target: "claude-repository",
				observed: [
					{
						surface: "surface:claude-repository",
						capabilityId: "capability:test",
					},
					{ surface: "root:unexpected", capabilityId: "capability:test" },
				],
			},
			{
				target: "claude-plugin",
				observed: [
					{ surface: "surface:claude-plugin", capabilityId: "capability:test" },
					{
						surface: "manifest:.claude-plugin/plugin.json:unknown",
						capabilityId: "capability:test",
					},
				],
			},
			{
				target: "codex-repository",
				observed: [],
			},
			{
				target: "codex-plugin",
				observed: [
					{ surface: "surface:codex-plugin", capabilityId: "capability:test" },
					{
						surface: "manifest:.codex-plugin/plugin.json:unknown",
						capabilityId: "capability:test",
					},
				],
			},
		];

		for (const fixture of fixtures) {
			const observed = {
				"claude-repository": [
					{
						surface: "surface:claude-repository",
						capabilityId: "capability:test",
					},
				],
				"claude-plugin": [
					{ surface: "surface:claude-plugin", capabilityId: "capability:test" },
				],
				"codex-repository": [
					{
						surface: "surface:codex-repository",
						capabilityId: "capability:test",
					},
				],
				"codex-plugin": [
					{ surface: "surface:codex-plugin", capabilityId: "capability:test" },
				],
			};
			observed[fixture.target] = fixture.observed;
			const { calls, deps } = fakeDeps({
				decodeHarnessCapabilities: () => capabilities,
				assertTargetOutputClosure: (options) => {
					calls.push(["assertTargetOutputClosure", options.target]);
					return assertOutputClosure(options);
				},
				assembleClaudeAssets: () => {
					calls.push(["assembleClaudeAssets"]);
					return {
						observed: {
							"claude-repository": observed["claude-repository"],
							"claude-plugin": observed["claude-plugin"],
						},
					};
				},
				assembleCodexAssets: () => {
					calls.push(["assembleCodexAssets"]);
					return {
						observed: {
							"codex-repository": observed["codex-repository"],
							"codex-plugin": observed["codex-plugin"],
						},
					};
				},
			});
			assert.throws(
				() =>
					assemblePluginDistIndependent({
						root: "/repo",
						pluginRoot: "/repo/plugin/pfdsl",
						deps,
					}),
				new RegExp(`output closure ${fixture.target}`),
			);
			const claudeAdapter = calls.findIndex(
				([kind]) => kind === "assembleClaudeAssets",
			);
			const codexAdapter = calls.findIndex(
				([kind]) => kind === "assembleCodexAssets",
			);
			const firstClosure = calls.findIndex(
				([kind]) => kind === "assertTargetOutputClosure",
			);
			assert.ok(claudeAdapter >= 0);
			assert.ok(codexAdapter > claudeAdapter);
			assert.ok(firstClosure > codexAdapter);
			assert.deepEqual(
				calls
					.slice(firstClosure)
					.filter(([kind]) => kind === "assertTargetOutputClosure")
					.map(([, target]) => target),
				[
					"claude-repository",
					"claude-plugin",
					"codex-repository",
					"codex-plugin",
				].slice(
					0,
					[
						"claude-repository",
						"claude-plugin",
						"codex-repository",
						"codex-plugin",
					].indexOf(fixture.target) + 1,
				),
			);
		}
	});

	it("restores provisional adapter outputs after every target closure failure", () => {
		const pluginRoot = "/repo/plugin/pfdsl";
		const codexPluginRoot = "/repo/plugin/pfdsl-codex";
		const codexRepositoryDestinations = [
			"/repo/AGENTS.md",
			"/repo/.codex/config.toml",
			"/repo/.codex/hooks.json",
			"/repo/.codex/GENERATED.md",
			"/repo/.agents/skills",
			"/repo/.codex/agents",
		];
		const fixtures = [
			{
				target: "claude-repository",
				observed: [
					{
						surface: "surface:claude-repository",
						capabilityId: "capability:test",
					},
					{ surface: "root:unexpected", capabilityId: "capability:test" },
				],
			},
			{
				target: "claude-plugin",
				observed: [
					{ surface: "surface:claude-plugin", capabilityId: "capability:test" },
					{
						surface: "manifest:.claude-plugin/plugin.json:unknown",
						capabilityId: "capability:test",
					},
				],
			},
			{
				target: "codex-repository",
				observed: [],
			},
			{
				target: "codex-plugin",
				observed: [
					{ surface: "surface:codex-plugin", capabilityId: "capability:test" },
					{
						surface: "manifest:.codex-plugin/plugin.json:unknown",
						capabilityId: "capability:test",
					},
				],
			},
		];
		const capabilities = [
			{
				id: "capability:test",
				mappings: Object.fromEntries(
					[
						"claude-repository",
						"claude-plugin",
						"codex-repository",
						"codex-plugin",
					].map((target) => [
						target,
						{ disposition: "transform", outputs: [`surface:${target}`] },
					]),
				),
			},
		];

		for (const fixture of fixtures) {
			const files = new Map([
				[pluginRoot, "directory"],
				[`${pluginRoot}/prior.txt`, "old Claude plugin"],
				[codexPluginRoot, "directory"],
				[`${codexPluginRoot}/prior.txt`, "old Codex plugin"],
				...codexRepositoryDestinations.flatMap((destination) => [
					[destination, `old ${destination}`],
					[`${destination}/prior.txt`, `old ${destination} child`],
				]),
			]);
			const before = new Map(files);
			const remove = (path) => {
				for (const existing of [...files.keys()]) {
					if (existing === path || existing.startsWith(`${path}/`))
						files.delete(existing);
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
			const copy = (from, to) => {
				for (const [path, content] of [...files]) {
					if (path === from || path.startsWith(`${from}/`))
						files.set(`${to}${path.slice(from.length)}`, content);
				}
			};
			const observed = {
				"claude-repository": [
					{
						surface: "surface:claude-repository",
						capabilityId: "capability:test",
					},
				],
				"claude-plugin": [
					{ surface: "surface:claude-plugin", capabilityId: "capability:test" },
				],
				"codex-repository": [
					{
						surface: "surface:codex-repository",
						capabilityId: "capability:test",
					},
				],
				"codex-plugin": [
					{ surface: "surface:codex-plugin", capabilityId: "capability:test" },
				],
			};
			observed[fixture.target] = fixture.observed;
			const { calls, deps } = fakeDeps({
				cpSync: copy,
				decodeHarnessCapabilities: () => capabilities,
				existsSync: (path) => files.has(path),
				mkdirSync: () => {},
				newRunId: () => `closure-${fixture.target}`,
				renameSync: move,
				rmSync: remove,
				assembleClaudeAssets: () => {
					calls.push(["assembleClaudeAssets"]);
					files.set(`${pluginRoot}/provisional.txt`, fixture.target);
					return {
						observed: {
							"claude-repository": observed["claude-repository"],
							"claude-plugin": observed["claude-plugin"],
						},
					};
				},
				assembleCodexAssets: () => {
					calls.push(["assembleCodexAssets"]);
					files.set(`${codexPluginRoot}/provisional.txt`, fixture.target);
					for (const destination of codexRepositoryDestinations) {
						remove(destination);
						files.set(destination, `new ${fixture.target}`);
						files.set(`${destination}/provisional.txt`, fixture.target);
					}
					return {
						observed: {
							"codex-repository": observed["codex-repository"],
							"codex-plugin": observed["codex-plugin"],
						},
					};
				},
			});

			assert.throws(
				() =>
					assemblePluginDistIndependent({
						root: "/repo",
						pluginRoot,
						codexPluginRoot,
						deps,
					}),
				new RegExp(`output closure ${fixture.target}`),
			);
			assert.deepEqual(files, before, fixture.target);
			assert.ok(calls.some(([kind]) => kind === "assembleClaudeAssets"));
			assert.ok(calls.some(([kind]) => kind === "assembleCodexAssets"));
		}
	});

	it("rejects a renamed Claude repository surface observed from its maintained source", () => {
		const capabilities = structuredClone(decodedHarnessCapabilities);
		const instructions = capabilities.find(
			(record) => record.id === "repository-instructions",
		);
		instructions.mappings["claude-repository"].outputs = ["RENAMED.md"];
		const { deps } = fakeDeps({
			decodeHarnessCapabilities: () => capabilities,
			assembleCodexAssets: () => ({
				observed: {
					"codex-repository": targetOutputEntries(
						capabilities,
						"codex-repository",
					),
					"codex-plugin": targetOutputEntries(capabilities, "codex-plugin"),
				},
			}),
		});

		assert.throws(
			() =>
				assemblePluginDistIndependent({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			/output closure claude-repository/,
		);
	});

	it("records the bundle content hash last, after every other bundled file is final", () => {
		const { calls, deps } = fakeDeps();
		assemblePluginDistIndependent({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});
		const refs = calls.findIndex((call) => call[0] === "writeSkillRefs");
		const bundleManifest = calls.findIndex(
			(call) => call[0] === "writeBundleManifest",
		);
		const codex = calls.findIndex((call) => call[0] === "assembleCodexAssets");
		assert.ok(refs < bundleManifest);
		assert.ok(bundleManifest < codex);
		assert.deepEqual(calls[bundleManifest], [
			"writeBundleManifest",
			"/repo/plugin/pfdsl",
		]);
	});

	it("removes migrated Claude-root outputs before recording the bundle content hash", () => {
		const pluginRoot = "/repo/plugin/pfdsl";
		const legacyOwnershipManifest = `${pluginRoot}/.codex-plugin/codex-command-skills.json`;
		const legacyOutputs = [
			`${pluginRoot}/skills/pfd-cycle`,
			`${pluginRoot}/.codex-plugin`,
			`${pluginRoot}/codex`,
		];
		const { calls, deps } = fakeDeps({
			existsSync: (path) => path === legacyOwnershipManifest,
			readFileSync: (path) => {
				if (path === legacyOwnershipManifest) {
					return JSON.stringify({
						skillRoot: "codex/skills",
						ownedSkillDirectories: ["pfd-cycle"],
					});
				}
				return String(path).endsWith("marketplace.json")
					? JSON.stringify(fakeMarketplace)
					: "---\nsummary: generated skill\n---\nbody\n";
			},
			rmSync: (path) => calls.push(["rmSync", path]),
		});

		assemblePluginDistIndependent({ root: "/repo", pluginRoot, deps });

		const bundleManifest = calls.findIndex(
			(call) => call[0] === "writeBundleManifest",
		);
		for (const output of legacyOutputs) {
			const cleanup = calls.findIndex(
				(call) => call[0] === "rmSync" && call[1] === output,
			);
			assert.ok(
				cleanup >= 0 && cleanup < bundleManifest,
				`${output} must be removed before recording the bundle content hash`,
			);
		}
	});

	it("restores the Claude snapshot and skips publication when legacy cleanup fails", () => {
		const pluginRoot = "/repo/plugin/pfdsl";
		const transactionRoot = "/repo/plugin/.pfdsl-gen-txn-cleanup-failure-test";
		const legacySkill = `${pluginRoot}/skills/pfd-cycle`;
		const legacyOwnershipManifest = `${pluginRoot}/.codex-plugin/codex-command-skills.json`;
		const { calls, deps } = fakeDeps({
			cpSync: (from, to) => calls.push(["cpSync", from, to]),
			existsSync: (path) =>
				path === pluginRoot || path === legacyOwnershipManifest,
			newRunId: () => "cleanup-failure-test",
			readFileSync: (path) => {
				if (path === legacyOwnershipManifest) {
					return JSON.stringify({
						skillRoot: "codex/skills",
						ownedSkillDirectories: ["pfd-cycle"],
					});
				}
				return String(path).endsWith("marketplace.json")
					? JSON.stringify(fakeMarketplace)
					: "---\nsummary: generated skill\n---\nbody\n";
			},
			renameSync: (from, to) => calls.push(["renameSync", from, to]),
			rmSync: (path) => {
				calls.push(["rmSync", path]);
				if (path === legacySkill) throw new Error("legacy cleanup failed");
			},
		});

		assert.throws(
			() => assemblePluginDistIndependent({ root: "/repo", pluginRoot, deps }),
			/legacy cleanup failed/,
		);
		assert.equal(
			calls.some((call) => call[0] === "writeBundleManifest"),
			false,
		);
		assert.equal(
			calls.some((call) => call[0] === "assembleCodexAssets"),
			false,
		);
		assert.ok(
			calls.some(
				(call) =>
					call[0] === "renameSync" &&
					call[1] === `${transactionRoot}/plugin-root` &&
					call[2] === pluginRoot,
			),
		);
	});

	it("restores both plugin roots when the later Codex assembly fails", () => {
		const pluginRoot = "/repo/plugin/pfdsl";
		const codexPluginRoot = "/repo/plugin/pfdsl-codex";
		const marketplacePath = "/repo/.claude-plugin/marketplace.json";
		const installRoot = "/repo/.claude/skills/pfd-ops/install";
		const files = new Map([
			[pluginRoot, "directory"],
			[`${pluginRoot}/skills/pfd-ops/SKILL.md`, "legacy Claude skill"],
			[codexPluginRoot, "directory"],
			[`${codexPluginRoot}/skills/pfd-ops/SKILL.md`, "legacy Codex skill"],
			[marketplacePath, "legacy marketplace"],
			[installRoot, "directory"],
			[`${installRoot}/install.md`, "legacy install"],
		]);
		const before = new Map(files);
		const remove = (path) => {
			for (const existing of [...files.keys()]) {
				if (existing === path || existing.startsWith(`${path}/`))
					files.delete(existing);
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
		const copy = (from, to) => {
			for (const [path, content] of [...files]) {
				if (path === from || path.startsWith(`${from}/`))
					files.set(`${to}${path.slice(from.length)}`, content);
			}
		};
		const { deps } = fakeDeps({
			cpSync: (from, to) => copy(from, to),
			existsSync: (path) => files.has(path),
			genInstall: () => files.set(`${installRoot}/install.md`, "new install"),
			mirrorDir: (name, _source, destination) =>
				files.set(`${destination}/${name}/SKILL.md`, "new Claude skill"),
			mirrorFiles: (_names, _source, destination) =>
				files.set(`${destination}/generated.md`, "new Claude file"),
			mkdirSync: () => {},
			newRunId: () => "rollback-test",
			renameSync: move,
			rmSync: remove,
			writeFileSync: (path, content) => files.set(path, content),
			assembleCodexAssets: () => {
				throw new Error("Codex assembly failed");
			},
		});

		assert.throws(
			() =>
				assemblePluginDistIndependent({
					root: "/repo",
					pluginRoot,
					codexPluginRoot,
					deps,
				}),
			/Codex assembly failed/,
		);
		const pluginFiles = (source) =>
			new Map(
				[...source].filter(
					([path]) =>
						path.startsWith(pluginRoot) ||
						path.startsWith(codexPluginRoot) ||
						path === marketplacePath ||
						path.startsWith(`${installRoot}/`) ||
						path === installRoot,
				),
			);
		assert.deepEqual(pluginFiles(files), pluginFiles(before));
		assert.equal(
			[...files.keys()].some((path) =>
				path.includes(".pfdsl-gen-txn-rollback-test"),
			),
			false,
		);
	});

	it("restores the Claude plugin root when an early mirror fails", () => {
		const pluginRoot = "/repo/plugin/pfdsl";
		const marketplacePath = "/repo/.claude-plugin/marketplace.json";
		const installRoot = "/repo/.claude/skills/pfd-ops/install";
		const files = new Map([
			[pluginRoot, "directory"],
			[`${pluginRoot}/skills/pfd-ops/SKILL.md`, "legacy Claude skill"],
			[marketplacePath, "legacy marketplace"],
			[installRoot, "directory"],
			[`${installRoot}/install.md`, "legacy install"],
		]);
		const before = new Map(files);
		const remove = (path) => {
			for (const existing of [...files.keys()]) {
				if (existing === path || existing.startsWith(`${path}/`))
					files.delete(existing);
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
		const copy = (from, to) => {
			for (const [path, content] of [...files]) {
				if (path === from || path.startsWith(`${from}/`))
					files.set(`${to}${path.slice(from.length)}`, content);
			}
		};
		let mirrors = 0;
		const { deps } = fakeDeps({
			cpSync: copy,
			existsSync: (path) => files.has(path),
			genInstall: () => files.set(`${installRoot}/install.md`, "new install"),
			mirrorDir: (name, _source, destination) => {
				files.set(`${destination}/${name}/SKILL.md`, "new Claude skill");
				mirrors += 1;
				if (mirrors === 2) throw new Error("mirror failed");
			},
			mkdirSync: () => {},
			newRunId: () => "early-failure-test",
			renameSync: move,
			rmSync: remove,
			writeFileSync: (path, content) => files.set(path, content),
		});

		assert.throws(
			() => assemblePluginDistIndependent({ root: "/repo", pluginRoot, deps }),
			/mirror failed/,
		);
		assert.deepEqual(files, before);
		assert.equal(
			[...files.keys()].some((path) =>
				path.includes(".pfdsl-gen-txn-early-failure-test"),
			),
			false,
		);
	});

	it("cleans a partial snapshot when its copy fails", () => {
		const pluginRoot = "/repo/plugin/pfdsl";
		const transactionRoot = "/repo/plugin/.pfdsl-gen-txn-snapshot-failure-test";
		const files = new Map([
			[pluginRoot, "directory"],
			[`${pluginRoot}/skills/pfd-ops/SKILL.md`, "legacy Claude skill"],
		]);
		const before = new Map(files);
		const remove = (path) => {
			for (const existing of [...files.keys()]) {
				if (existing === path || existing.startsWith(`${path}/`))
					files.delete(existing);
			}
		};
		const { deps } = fakeDeps({
			cpSync: (_from, destination) => {
				files.set(destination, "partial backup");
				throw new Error("snapshot copy failed");
			},
			existsSync: (path) => files.has(path),
			newRunId: () => "snapshot-failure-test",
			rmSync: remove,
		});

		assert.throws(
			() => assemblePluginDistIndependent({ root: "/repo", pluginRoot, deps }),
			/snapshot copy failed/,
		);
		assert.deepEqual(files, before);
		assert.equal(files.has(transactionRoot), false);
	});

	it("keeps the snapshot when rollback restoration fails", () => {
		const pluginRoot = "/repo/plugin/pfdsl";
		const transactionRoot = "/repo/plugin/.pfdsl-gen-txn-restore-failure-test";
		const backup = `${transactionRoot}/plugin-root`;
		const files = new Map([
			[pluginRoot, "directory"],
			[`${pluginRoot}/skills/pfd-ops/SKILL.md`, "legacy Claude skill"],
		]);
		const remove = (path) => {
			for (const existing of [...files.keys()]) {
				if (existing === path || existing.startsWith(`${path}/`))
					files.delete(existing);
			}
		};
		const copy = (from, to) => {
			for (const [path, content] of [...files]) {
				if (path === from || path.startsWith(`${from}/`))
					files.set(`${to}${path.slice(from.length)}`, content);
			}
		};
		const { deps } = fakeDeps({
			cpSync: copy,
			existsSync: (path) => files.has(path),
			mirrorDir: (name, _source, destination) =>
				files.set(`${destination}/${name}/SKILL.md`, "new Claude skill"),
			mkdirSync: () => {},
			newRunId: () => "restore-failure-test",
			renameSync: (from, to) => {
				if (from === backup && to === pluginRoot)
					throw new Error("restore rename failed");
			},
			rmSync: remove,
			writeFileSync: (path, content) => files.set(path, content),
			assembleCodexAssets: () => {
				throw new Error("Codex assembly failed");
			},
		});

		let error;
		try {
			assemblePluginDistIndependent({ root: "/repo", pluginRoot, deps });
		} catch (caught) {
			error = caught;
		}
		assert.match(error.message, /Codex assembly failed/);
		assert.equal(error.rollbackBackup, transactionRoot);
		assert.equal(
			files.get(`${backup}/skills/pfd-ops/SKILL.md`),
			"legacy Claude skill",
		);
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
				decodeHarnessCapabilities: () => decodedHarnessCapabilities,
				existsSync: () => false,
				mkdirSync: (path) => calls.push(["mkdirSync", path]),
				newRunId: () => "test-run",
				readFileSync: (path) => {
					calls.push(["readFileSync", path]);
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

	it("stages Codex skills from neutral generated sources without a Claude plugin root", () => {
		const { calls, deps } = fakeCodexDeps();
		assembleCodexAssets({
			root: "/repo",
			codexPluginRoot: "/repo/plugin/pfdsl-codex",
			deps,
		});
		assert.equal(
			calls
				.filter(([kind]) => kind === "cpSync")
				.some(([, source]) => String(source).startsWith("/repo/plugin/pfdsl")),
			false,
		);
		assert.equal(
			calls
				.filter(([kind]) => kind === "cpSync")
				.some(
					([, source]) => String(source) === "/repo/generated/skills/pfdsl",
				),
			true,
		);
		assert.equal(
			calls
				.filter(([kind]) => kind === "readFileSync")
				.some(([, path]) => String(path).startsWith("/repo/plugin/pfdsl")),
			false,
		);
		for (const name of ["pfd-cycle", "pfd-init", "source-command-pfd-retro"]) {
			assert.ok(
				calls.some(
					([kind, path]) =>
						kind === "writeFileSync" &&
						String(path).includes(
							`.agents/skills.codex-tmp-test-run/${name}/SKILL.md`,
						),
				),
				name,
			);
		}
	});

	it("builds both harness manifests from one decoded metadata record", () => {
		const capabilities = structuredClone(decodedHarnessCapabilities);
		const metadata = capabilities.find(
			(record) => record.id === "plugin-metadata",
		);
		metadata.semantic.version = "9.9.9";
		metadata.semantic.identity = {
			name: "decoded-pfdsl",
			author: { name: "Decoded Author" },
			homepage: "https://example.test/decoded-pfdsl",
			license: "Apache-2.0",
		};
		const claudeCalls = [];
		const claudeDeps = {
			existsSync: () => false,
			genInstall: () => {},
			mirrorDir: () => {},
			mirrorFiles: () => {},
			mkdirSync: () => {},
			readFileSync: (path) => {
				if (String(path).endsWith("marketplace.json")) {
					return JSON.stringify({ plugins: [{ description: "stale" }] });
				}
				if (String(path).endsWith("package.json")) {
					return JSON.stringify({ version: "1.2.3" });
				}
				return "---\nsummary: injected skill\n---\nbody\n";
			},
			rmSync: () => {},
			writeBundleManifest: () => {},
			writeFileSync: (path, content) =>
				claudeCalls.push(["writeFileSync", path, content]),
			writeSkillRefs: () => {},
		};
		assembleClaudeAssets({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			capabilities,
			deps: claudeDeps,
		});
		const [, , claudeManifest] = claudeCalls.find(
			([kind, path]) =>
				kind === "writeFileSync" &&
				String(path).endsWith(".claude-plugin/plugin.json"),
		);

		const { calls: codexCalls, deps: codexDeps } = fakeCodexDeps();
		assembleCodexAssets({
			root: "/repo",
			codexPluginRoot: "/repo/plugin/pfdsl-codex",
			capabilities,
			deps: codexDeps,
		});
		const [, , codexManifest] = codexCalls.find(
			([kind, path]) =>
				kind === "writeFileSync" &&
				String(path).endsWith(".codex-plugin/plugin.json.codex-tmp-test-run"),
		);

		assert.deepEqual(
			{
				name: JSON.parse(claudeManifest).name,
				version: JSON.parse(claudeManifest).version,
				license: JSON.parse(claudeManifest).license,
			},
			{
				name: JSON.parse(codexManifest).name,
				version: JSON.parse(codexManifest).version,
				license: JSON.parse(codexManifest).license,
			},
		);
		assert.equal(JSON.parse(codexManifest).version, "9.9.9");
		assert.equal(JSON.parse(codexManifest).name, "decoded-pfdsl");
	});

	function statefulCodexDeps({ failRemove, failWrite, failPublish } = {}) {
		const { calls, deps: sourceDeps } = fakeCodexDeps();
		const files = new Map();
		const destinations = [
			"/repo/AGENTS.md",
			"/repo/.codex/config.toml",
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

	it("removes stale Codex command skills while preserving a new collision target", () => {
		const { deps, files } = statefulCodexDeps();
		const codexSkillsRoot = "/repo/plugin/pfdsl-codex/skills";
		const codexManifestPath =
			"/repo/plugin/pfdsl-codex/.codex-plugin/codex-command-skills.json";
		files.set(
			codexManifestPath,
			JSON.stringify({
				skillRoot: "skills",
				ownedSkillDirectories: ["removed-command", "pfd-retro"],
			}),
		);
		files.set(`${codexSkillsRoot}/removed-command`, "directory");
		files.set(
			`${codexSkillsRoot}/removed-command/SKILL.md`,
			"obsolete command",
		);

		assembleCodexAssets({
			root: "/repo",
			deps,
		});

		assert.equal(files.has(`${codexSkillsRoot}/removed-command`), false);
		assert.deepEqual(JSON.parse(files.get(codexManifestPath)), {
			skillRoot: "skills",
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
			"/repo/plugin/pfdsl-codex/.codex-plugin/codex-command-skills.json";
		files.set(manifestPath, "{}");

		assert.throws(
			() =>
				assembleCodexAssets({
					root: "/repo",
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

	it("removes its assembly lock after successful publication", () => {
		const { deps, files } = statefulCodexDeps();

		assembleCodexAssets({
			root: "/repo",
			pluginRoot: "/repo/plugin/pfdsl",
			deps,
		});

		assert.equal(files.has("/repo/.codex-assets-assembly.lock"), false);
	});

	it("keeps committed Codex outputs when backup or lock cleanup fails", () => {
		let agentBackupRemovals = 0;
		const { deps, files } = statefulCodexDeps({
			failRemove: (path) => {
				const normalized = String(path);
				if (normalized.startsWith("/repo/AGENTS.md.codex-prev")) {
					agentBackupRemovals += 1;
					return agentBackupRemovals === 2;
				}
				return normalized.endsWith(".codex-assets-assembly.lock");
			},
		});
		const warnings = [];
		const originalWarn = console.warn;
		console.warn = (message) => warnings.push(message);
		try {
			assert.doesNotThrow(() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			);
		} finally {
			console.warn = originalWarn;
		}

		assert.equal(files.has("/repo/.codex-assets-assembly.lock"), false);
		assert.equal(
			files.has("/repo/.codex-assets-assembly.lock.stale-stateful-run"),
			true,
		);
		assert.match(
			warnings.join("\n"),
			/\.codex-assets-assembly\.lock\.stale-stateful-run/,
		);
		assert.equal(files.has("/repo/AGENTS.md/prior.txt"), false);
		assert.match(
			files.get("/repo/AGENTS.md"),
			/^<!-- DO NOT EDIT\. Authoritative source: CLAUDE\.md\. -->$/m,
		);
		assert.match(
			files.get("/repo/AGENTS.md"),
			/親 agent が `git fetch`、stage、commit、`git push`、PR の作成・更新、issue の作成・クローズ・コメントを担当する。/,
		);
		console.warn = () => {};
		try {
			assert.doesNotThrow(() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			);
		} finally {
			console.warn = originalWarn;
		}
	});

	it("warns with the canonical lock path when stale-lock quarantine fails", () => {
		const { deps, files } = statefulCodexDeps({
			failRemove: (path) =>
				String(path).endsWith(".codex-assets-assembly.lock"),
		});
		const originalRename = deps.renameSync;
		deps.renameSync = (from, to) => {
			if (
				String(from).endsWith(".codex-assets-assembly.lock") &&
				String(to).includes(".stale-")
			)
				throw new Error("quarantine rename failed");
			return originalRename(from, to);
		};
		const warnings = [];
		const originalWarn = console.warn;
		console.warn = (message) => warnings.push(message);
		try {
			assert.doesNotThrow(() =>
				assembleCodexAssets({
					root: "/repo",
					pluginRoot: "/repo/plugin/pfdsl",
					deps,
				}),
			);
		} finally {
			console.warn = originalWarn;
		}

		assert.equal(files.has("/repo/.codex-assets-assembly.lock"), true);
		assert.match(warnings.join("\n"), /\.codex-assets-assembly\.lock/);
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
				"/repo/.codex/config.toml",
				"/repo/.codex/GENERATED.md",
				"/repo/.codex/hooks.json",
				"/repo/plugin/pfdsl-codex/GENERATED.md",
				"/repo/plugin/pfdsl-codex/.codex-plugin/codex-command-skills.json",
				"/repo/plugin/pfdsl-codex/.codex-plugin/plugin.json",
				"/repo/plugin/pfdsl-codex/hooks",
				"/repo/plugin/pfdsl-codex/skills",
			].sort(),
		);

		const copied = calls.filter(([kind]) => kind === "cpSync");
		assert.equal(
			copied.some(([, , path]) =>
				path.includes(".agents/skills.codex-tmp-test-run/pfd-grill"),
			),
			true,
		);
		assert.equal(
			copied.some(([, , path]) =>
				path.includes(".agents/skills.codex-tmp-test-run/pfd-ops"),
			),
			true,
		);
		const staged = calls.filter(([kind]) => kind === "writeFileSync");
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
					"pfdsl-codex/skills.codex-tmp-test-run/source-command-pfd-retro/SKILL.md",
				),
			),
			true,
		);

		const [, , manifest] = staged.find(([, path]) =>
			path.endsWith("pfdsl-codex/.codex-plugin/plugin.json.codex-tmp-test-run"),
		);
		assert.equal(Object.hasOwn(JSON.parse(manifest), "hooks"), false);
		const [, , config] = staged.find(([, path]) =>
			path.endsWith(".codex/config.toml.codex-tmp-test-run"),
		);
		assert.equal(
			config,
			'# DO NOT EDIT. Authoritative source: scripts/lib/gen-codex-assets.mjs.\n\nsandbox_mode = "workspace-write"\napproval_policy = "on-request"\n\n[sandbox_workspace_write]\nnetwork_access = true\n',
		);
		const [, , ownership] = staged.find(([, path]) =>
			path.endsWith(
				"pfdsl-codex/.codex-plugin/codex-command-skills.json.codex-tmp-test-run",
			),
		);
		assert.deepEqual(JSON.parse(ownership), {
			skillRoot: "skills",
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
			failWrite: (path) =>
				path.includes("codex/skills.codex-tmp") && path.includes("pfd-init"),
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

describe("target-local consumer probes", () => {
	it("observes an undeclared logical consumer surface instead of copying declarations", () => {
		const fixture = PROBE_FIXTURES["codex-plugin-consumer"];
		const consumer = mkdtempSync(join(tmpdir(), "codex-plugin-extra-"));
		try {
			fixture.prepare(repoRoot, consumer);
			const extra = join(consumer, "plugin/skills/extra-tool/SKILL.md");
			mkdirSync(dirname(extra), { recursive: true });
			writeFileSync(extra, "extra tool\n");
			const result = runTargetConsumerProbe(
				fixture,
				consumer,
				decodedHarnessCapabilities,
			);

			assert.throws(
				() =>
					assertOutputClosure({
						target: fixture.target,
						declared: targetOutputEntries(
							decodedHarnessCapabilities,
							fixture.target,
						),
						observed: result.observed,
					}),
				/undeclared surface skills\/extra-tool/,
			);
		} finally {
			rmSync(consumer, { recursive: true, force: true });
		}
	});

	it("rejects a manifest symlink that resolves outside its target root", () => {
		const fixture = PROBE_FIXTURES["codex-plugin-consumer"];
		const consumer = mkdtempSync(join(tmpdir(), "codex-plugin-symlink-"));
		const outside = mkdtempSync(join(tmpdir(), "codex-plugin-outside-"));
		try {
			fixture.prepare(repoRoot, consumer);
			const manifest = join(consumer, "plugin/.codex-plugin/plugin.json");
			const outsideManifest = join(outside, "plugin.json");
			writeFileSync(
				outsideManifest,
				JSON.stringify({ name: "outside", version: "0.0.0" }),
			);
			rmSync(manifest, { force: true });
			symlinkSync(outsideManifest, manifest);

			assert.throws(
				() =>
					runTargetConsumerProbe(fixture, consumer, decodedHarnessCapabilities),
				/outside target root/,
			);
		} finally {
			rmSync(consumer, { recursive: true, force: true });
			rmSync(outside, { recursive: true, force: true });
		}
	});

	for (const [kind, fixture] of Object.entries(PROBE_FIXTURES)) {
		it(`runs ${kind} against only its target-local fixture root`, () => {
			const consumer = mkdtempSync(join(tmpdir(), `${kind}-`));
			try {
				fixture.prepare(repoRoot, consumer);
				for (const sibling of fixture.forbidden) {
					assert.equal(existsSync(join(consumer, sibling)), false, sibling);
				}
				const result = runTargetConsumerProbe(
					fixture,
					consumer,
					decodedHarnessCapabilities,
				);
				assert.ok(result.readPaths.length > 0, kind);
				assert.ok(
					result.readPaths.every(
						(path) =>
							path === result.targetRoot ||
							path.startsWith(`${result.targetRoot}/`),
					),
					`${kind} read outside target root`,
				);
				assertOutputClosure({
					target: fixture.target,
					declared: targetOutputEntries(
						decodedHarnessCapabilities,
						fixture.target,
					),
					observed: result.observed,
				});
				if (fixture.target === "codex-plugin") {
					assert.equal(existsSync(join(result.targetRoot, "agents")), false);
				}
			} finally {
				rmSync(consumer, { recursive: true, force: true });
			}
		});
	}
});

describe("Codex generated consumers", () => {
	it("ships a self-contained native skill tree without mutating the Claude tree", () => {
		const pluginRoot = join(repoRoot, "plugin/pfdsl");
		const codexPluginRoot = join(repoRoot, "plugin/pfdsl-codex");
		const claudeBefore = treeFiles(pluginRoot).map((relativePath) => [
			relativePath,
			readFileSync(join(pluginRoot, relativePath)).toString("base64"),
		]);
		assert.deepEqual(
			treeFiles(pluginRoot).map((relativePath) => [
				relativePath,
				readFileSync(join(pluginRoot, relativePath)).toString("base64"),
			]),
			claudeBefore,
		);
		const consumer = mkdtempSync(join(tmpdir(), "codex-plugin-consumer-"));
		try {
			const pluginCopy = join(consumer, "plugin-cache/pfdsl-codex");
			cpSync(codexPluginRoot, pluginCopy, { recursive: true });
			const manifest = JSON.parse(
				readFileSync(join(pluginCopy, ".codex-plugin/plugin.json"), "utf-8"),
			);
			assert.equal(manifest.skills, "./skills/");
			const skillsRoot = resolve(pluginCopy, manifest.skills);
			assert.equal(existsSync(join(skillsRoot, "pfd-ops/SKILL.md")), true);
			assert.equal(
				existsSync(join(pluginCopy, "skills/pfd-cycle/SKILL.md")),
				true,
			);
			const legacyFiles = treeFiles(join(pluginRoot, "skills"));
			const nativeFiles = treeFiles(skillsRoot);
			assert.deepEqual(
				nativeFiles.sort(),
				[
					...legacyFiles,
					"pfd-cycle/SKILL.md",
					"pfd-init/SKILL.md",
					"source-command-pfd-retro/SKILL.md",
				].sort(),
			);
			for (const relativePath of legacyFiles) {
				const legacy = readFileSync(join(pluginRoot, "skills", relativePath));
				const native = readFileSync(join(skillsRoot, relativePath));
				if (relativePath.endsWith(".md")) {
					assert.equal(
						generatedMarkdownNoticeCount(native.toString("utf-8")),
						1,
						relativePath,
					);
					assert.equal(
						removeGeneratedMarkdownNotice(native.toString("utf-8")),
						expectedCodexMarkdown(legacy.toString("utf-8")),
						relativePath,
					);
				} else if (relativePath.endsWith(".mjs")) {
					assert.equal(
						generatedSourceCommentCount(native.toString("utf-8")),
						1,
						relativePath,
					);
					assert.equal(
						removeGeneratedSourceComment(native.toString("utf-8")),
						legacy.toString("utf-8"),
						relativePath,
					);
				} else {
					assert.deepEqual(native, legacy, relativePath);
				}
			}
			const nativePfdOpsSkill = readFileSync(
				join(skillsRoot, "pfd-ops/SKILL.md"),
				"utf-8",
			);
			assert.match(
				nativePfdOpsSkill,
				/DO NOT EDIT\. Authoritative source: \.claude\/skills\/pfd-ops\/SKILL\.md\./,
			);
			const nativeScript = readFileSync(
				join(skillsRoot, "pfd-ops/scripts/check-install-sync.mjs"),
				"utf-8",
			);
			assert.match(
				nativeScript,
				/DO NOT EDIT\. Authoritative source: \.claude\/skills\/pfd-ops\/scripts\/check-install-sync\.mjs\./,
			);
			assert.equal(
				removeGeneratedSourceComment(nativeScript),
				readFileSync(
					join(pluginRoot, "skills/pfd-ops/scripts/check-install-sync.mjs"),
					"utf-8",
				),
			);
			const nativePfdslSkill = readFileSync(
				join(skillsRoot, "pfdsl/SKILL.md"),
				"utf-8",
			);
			assert.match(
				nativePfdslSkill,
				/# DO NOT EDIT — generated by scripts\/gen-skill\.mjs\. Authoritative source: https:\/\/github\.com\/takasek\/pfdsl\/blob\/main\/scripts\/skill-template\/SKILL\.md/,
			);
			const nativePfdslQualityGuide = readFileSync(
				join(skillsRoot, "pfdsl/references/quality-guide.md"),
				"utf-8",
			);
			assert.match(
				nativePfdslQualityGuide,
				/<!-- DO NOT EDIT — snapshot distributed with pfdsl skill\. Authoritative source: https:\/\/github\.com\/takasek\/pfdsl\/blob\/main\/docs\/quality-guide\.md -->/,
			);

			const legacyBefore = JSON.stringify(
				markdownFiles(join(pluginRoot, "skills")).map((relativePath) => [
					relativePath,
					readFileSync(join(pluginRoot, "skills", relativePath), "utf-8"),
				]),
			);
			const markdown = markdownFiles(skillsRoot);
			assert.ok(markdown.length > 0);
			for (const relativePath of markdown) {
				const output = readFileSync(join(skillsRoot, relativePath), "utf-8");
				const transformed = removeGeneratedMarkdownNotice(output);
				assert.doesNotMatch(transformed, /\.claude\/skills\//, relativePath);
				assert.doesNotMatch(
					transformed,
					/\$\{CLAUDE_PLUGIN_ROOT\}/,
					relativePath,
				);
				assert.doesNotMatch(
					transformed,
					/CLAUDE_PLUGIN_ROOT|Claude 向け|Claude へ|1つの Claude Code plugin|Claude Code プラットフォーム側/,
					relativePath,
				);
			}

			const output = execFileSync(
				process.execPath,
				[join(skillsRoot, "pfd-ops/scripts/check-install-sync.mjs")],
				{ cwd: consumer, encoding: "utf-8" },
			);
			assert.match(output, /not adopted/);
			const pfdslHelp = execFileSync(
				process.execPath,
				[join(repoRoot, "packages/cli/dist/cli.js"), "--help"],
				{ cwd: consumer, encoding: "utf-8" },
			);
			assert.match(pfdslHelp, /^pfdsl <command>/);
			assert.equal(
				JSON.stringify(
					markdownFiles(join(pluginRoot, "skills")).map((relativePath) => [
						relativePath,
						readFileSync(join(pluginRoot, "skills", relativePath), "utf-8"),
					]),
				),
				legacyBefore,
			);
		} finally {
			rmSync(consumer, { recursive: true, force: true });
		}
	});

	it("transforms every Markdown file in Codex skill trees and preserves scripts", () => {
		const consumer = mkdtempSync(join(tmpdir(), "codex-agents-consumer-"));
		try {
			cpSync(join(repoRoot, ".agents"), join(consumer, ".agents"), {
				recursive: true,
			});
			assert.equal(existsSync(join(consumer, ".claude")), false);
			const agentScript = readFileSync(
				join(consumer, ".agents/skills/pfd-ops/scripts/check-install-sync.mjs"),
				"utf-8",
			);
			assert.match(
				agentScript,
				/DO NOT EDIT\. Authoritative source: \.claude\/skills\/pfd-ops\/scripts\/check-install-sync\.mjs\./,
			);
			assert.equal(generatedSourceCommentCount(agentScript), 1);
			assert.equal(
				removeGeneratedSourceComment(agentScript),
				readFileSync(
					join(
						repoRoot,
						".claude/skills/pfd-ops/scripts/check-install-sync.mjs",
					),
					"utf-8",
				),
			);
			const script = readFileSync(
				join(consumer, ".agents/skills/pfd-ops/scripts/check-install-sync.mjs"),
				"utf-8",
			);
			assert.match(script, /\.claude\/pfd-ops-install-manifest\.json/);

			const markdown = markdownFiles(join(consumer, ".agents/skills"));
			assert.ok(markdown.length > 0);
			for (const relativePath of markdown) {
				const output = readFileSync(
					join(consumer, ".agents/skills", relativePath),
					"utf-8",
				);
				const [skillName] = relativePath.split("/");
				const command = decodedHarnessCapabilities.find(
					(record) =>
						record.kind === "command" &&
						record.mappings["codex-repository"].outputs.includes(
							`.agents/skills/${skillName}`,
						),
				);
				if (command) {
					assert.equal(generatedMarkdownNoticeCount(output), 1, relativePath);
					assert.match(
						output,
						new RegExp(
							`DO NOT EDIT\\. Authoritative source: ${command.source.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`,
						),
					);
					assert.equal(
						output,
						claudeInstructionsToAgents(
							commandCapabilityToCodexSkill(command, skillName),
						).replace(/(?:\r?\n){2,}$/, "\n"),
						relativePath,
					);
					continue;
				}
				const source = readFileSync(
					codexMarkdownSource(repoRoot, relativePath),
					"utf-8",
				);
				assert.equal(generatedMarkdownNoticeCount(output), 1, relativePath);
				if (!relativePath.startsWith("pfdsl/")) {
					assert.match(
						output,
						new RegExp(
							`DO NOT EDIT\\. Authoritative source: \\.claude/skills/${relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`,
						),
						relativePath,
					);
				}
				assert.equal(
					removeGeneratedMarkdownNotice(output),
					expectedCodexMarkdown(source),
					relativePath,
				);
				const transformed = removeGeneratedMarkdownNotice(output);
				assert.doesNotMatch(transformed, /\.claude\/skills\//, relativePath);
				assert.doesNotMatch(
					transformed,
					/\$\{CLAUDE_PLUGIN_ROOT\}/,
					relativePath,
				);
				assert.doesNotMatch(
					transformed,
					/CLAUDE_PLUGIN_ROOT|Claude 向け|Claude へ|1つの Claude Code plugin|Claude Code プラットフォーム側/,
					relativePath,
				);
			}
			const agentPfdslSkill = readFileSync(
				join(consumer, ".agents/skills/pfdsl/SKILL.md"),
				"utf-8",
			);
			assert.match(
				agentPfdslSkill,
				/# DO NOT EDIT — generated by scripts\/gen-skill\.mjs\. Authoritative source: https:\/\/github\.com\/takasek\/pfdsl\/blob\/main\/scripts\/skill-template\/SKILL\.md/,
			);
			const agentPfdslQualityGuide = readFileSync(
				join(consumer, ".agents/skills/pfdsl/references/quality-guide.md"),
				"utf-8",
			);
			assert.match(
				agentPfdslQualityGuide,
				/<!-- DO NOT EDIT — snapshot distributed with pfdsl skill\. Authoritative source: https:\/\/github\.com\/takasek\/pfdsl\/blob\/main\/docs\/quality-guide\.md -->/,
			);

			const architecture = readFileSync(
				join(consumer, ".agents/skills/pfd-ops/references/architecture.md"),
				"utf-8",
			);
			assert.match(architecture, /\$\{PLUGIN_ROOT\}\/skills\/pfd-ops/);
			assert.match(architecture, /\.agents\/skills\/pfd-ops/);
			const scaffold = readFileSync(
				join(consumer, ".agents/skills/pfd-ops/references/scaffold/roadmap.md"),
				"utf-8",
			);
			assert.match(scaffold, /\$\{PLUGIN_ROOT\}\/skills\/pfd-ops/);
			assert.match(scaffold, /\.agents\/skills\/pfd-ops/);

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

	it("runs both configured reminders from each generated plugin consumer", () => {
		const pluginRoot = join(repoRoot, "plugin/pfdsl");
		const codexPluginRoot = join(repoRoot, "plugin/pfdsl-codex");

		const consumer = mkdtempSync(join(tmpdir(), "generated-hook-consumer-"));
		try {
			const roadmap = join(consumer, ".pfdsl/roadmap.pfdsl");
			mkdirSync(dirname(roadmap), { recursive: true });
			writeFileSync(roadmap, "artifact:\n  delivery:\n    status: wip\n");
			execFileSync("git", ["init", "-q"], { cwd: consumer });
			execFileSync("git", ["add", ".pfdsl/roadmap.pfdsl"], { cwd: consumer });
			execFileSync(
				"git",
				[
					"-c",
					"user.name=Hook Test",
					"-c",
					"user.email=hook-test@example.invalid",
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
					"user.name=Hook Test",
					"-c",
					"user.email=hook-test@example.invalid",
					"commit",
					"-qm",
					"mark delivery done",
				],
				{ cwd: consumer },
			);

			for (const [plugin, consumerName] of [
				[pluginRoot, "Claude"],
				[codexPluginRoot, "Codex"],
			]) {
				const pluginCopy = join(consumer, consumerName);
				cpSync(plugin, pluginCopy, { recursive: true });
				assert.equal(existsSync(join(consumer, ".claude")), false);
				const hookConfig = JSON.parse(
					readFileSync(join(pluginCopy, "hooks/hooks.json"), "utf-8"),
				);
				const commands = hookConfig.hooks.PostToolUse[0].hooks;
				const managedIssueCommand = commands.find((hook) =>
					hook.command.includes("managed-issue-reminder-post-tool-use.mjs"),
				)?.command;
				const retroCommand = commands.find((hook) =>
					hook.command.includes("retro-reminder-post-tool-use.mjs"),
				)?.command;
				assert.ok(
					managedIssueCommand,
					`${consumerName} has a managed-issue hook`,
				);
				assert.ok(retroCommand, `${consumerName} has a retro hook`);
				for (const command of [managedIssueCommand, retroCommand]) {
					assert.match(command, /\$\{CLAUDE_PLUGIN_ROOT\}/, consumerName);
					assert.doesNotMatch(command, /\$\{PLUGIN_ROOT\}/, consumerName);
				}
				const managedIssueOutput = execFileSync(
					"/bin/sh",
					["-c", managedIssueCommand],
					{
						cwd: consumer,
						encoding: "utf-8",
						env: {
							...hookHostEnvironment,
							CLAUDE_PLUGIN_ROOT: pluginCopy,
						},
						input: JSON.stringify({
							tool_name: "Bash",
							tool_input: {
								command: "gh issue create --label flow:managed --title example",
							},
							tool_response: {
								stdout: "https://github.com/takasek/pfdsl/issues/654\\n",
								stderr: "",
							},
						}),
					},
				);
				const parsedOutput = JSON.parse(managedIssueOutput);
				assert.equal(
					parsedOutput.hookSpecificOutput.hookEventName,
					"PostToolUse",
				);
				assert.match(
					parsedOutput.hookSpecificOutput.additionalContext,
					/#654.*roadmap\.pfdsl/,
				);
				for (const input of [
					JSON.stringify({
						tool_name: "Bash",
						tool_input: {
							command: "gh issue create --label flow:managed --title example",
						},
						tool_response: { stdout: "", stderr: "HTTP 422" },
					}),
					"not json{{{",
					JSON.stringify({
						tool_name: "Bash",
						tool_input: { command: "gh issue list --label flow:managed" },
						tool_response: {
							stdout: "https://github.com/takasek/pfdsl/issues/654\\n",
							stderr: "",
						},
					}),
				]) {
					assert.equal(
						execFileSync("/bin/sh", ["-c", managedIssueCommand], {
							cwd: consumer,
							encoding: "utf-8",
							env: {
								...hookHostEnvironment,
								CLAUDE_PLUGIN_ROOT: pluginCopy,
							},
							input,
						}),
						"",
						consumerName,
					);
				}

				const retroOutput = execFileSync("/bin/sh", ["-c", retroCommand], {
					cwd: consumer,
					encoding: "utf-8",
					env: {
						...hookHostEnvironment,
						CLAUDE_PLUGIN_ROOT: pluginCopy,
					},
					input: JSON.stringify({
						cwd: consumer,
						tool_input: { command: "git commit -m mark-delivery-done" },
					}),
				});
				assert.deepEqual(JSON.parse(retroOutput), {
					hookSpecificOutput: {
						hookEventName: "PostToolUse",
						additionalContext:
							"note: this commit marks a roadmap artifact done — run pfd-retro if warranted.",
					},
				});
			}
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
