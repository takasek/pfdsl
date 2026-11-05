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
// Where the collector is run from. Several fixtures use `tmp` itself as the
// plugin bundle root, and a working directory inside the bundle means no
// project, so these cannot run from `tmp`.
let projectDir;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "collect-report-environment-"));
	projectDir = mkdtempSync(join(tmpdir(), "collect-report-environment-cwd-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
	rmSync(projectDir, { recursive: true, force: true });
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

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			cwd: projectDir,
		});

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

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			cwd: projectDir,
		});

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

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			cwd: projectDir,
		});

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

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			cwd: projectDir,
		});

		assert.equal(env.cliVersion, null);
		assert.ok(
			env.unavailable.some(({ field }) => field === "cliVersion"),
			"cliVersion should be recorded as unavailable",
		);
	});

	describe("repoCliVersion", () => {
		// The PATH `pfdsl --version` stays in cliVersion. A repository that pins
		// @pfdsl/cli in its package.json can run a different CLI than the one on
		// PATH, and the report has to show both.
		function adopter() {
			const repoRoot = join(tmp, "adopter");
			const skillRoot = join(repoRoot, ".claude", "skills", "pfd-ops");
			mkdirSync(skillRoot, { recursive: true });
			mkdirSync(join(repoRoot, ".git"), { recursive: true });
			writeProvenance(repoRoot);
			return { repoRoot, skillRoot };
		}

		const pathCli = (command) => (command === "pfdsl" ? "0.0.25" : null);

		for (const section of [
			"dependencies",
			"devDependencies",
			"optionalDependencies",
		]) {
			it(`reports the installed version next to the PATH version when ${section} lists @pfdsl/cli`, () => {
				const { repoRoot, skillRoot } = adopter();
				writeJson(join(repoRoot, "package.json"), {
					[section]: { "@pfdsl/cli": "^0.0.26" },
				});
				writeJson(join(repoRoot, "node_modules/@pfdsl/cli/package.json"), {
					name: "@pfdsl/cli",
					version: "0.0.26",
				});

				const env = collectReportEnvironment(skillRoot, {
					runCommand: pathCli,
				});

				assert.equal(env.cliVersion, "0.0.25");
				assert.equal(env.repoCliVersion, "0.0.26");
				assert.ok(
					!env.unavailable.some(({ field }) => field === "repoCliVersion"),
				);
			});
		}

		it("records repoCliVersion as unavailable when the dependency is declared but not installed", () => {
			const { repoRoot, skillRoot } = adopter();
			writeJson(join(repoRoot, "package.json"), {
				devDependencies: { "@pfdsl/cli": "^0.0.26" },
			});

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
			});

			assert.equal(env.cliVersion, "0.0.25");
			assert.equal(env.repoCliVersion, null);
			const failure = env.unavailable.find(
				({ field }) => field === "repoCliVersion",
			);
			assert.ok(failure, "repoCliVersion should be recorded as unavailable");
			assert.match(failure.reason, /not installed/);
		});

		// The reason ends up in a public upstream issue, so it states the category
		// of the failure and never the declared value, which can be a local path.
		it("never puts the declared spec in the unavailable reason", () => {
			for (const spec of [
				"file:/Users/someone/private/x.tgz",
				"link:../secret-checkout/packages/cli",
				"^0.0.26",
			]) {
				for (const installed of [null, { version: "" }]) {
					const { repoRoot, skillRoot } = adopter();
					writeJson(join(repoRoot, "package.json"), {
						devDependencies: { "@pfdsl/cli": spec },
					});
					rmSync(join(repoRoot, "node_modules"), {
						recursive: true,
						force: true,
					});
					if (installed !== null) {
						writeJson(
							join(repoRoot, "node_modules/@pfdsl/cli/package.json"),
							installed,
						);
					}

					const env = collectReportEnvironment(skillRoot, {
						runCommand: pathCli,
					});

					const { reason } = env.unavailable.find(
						({ field }) => field === "repoCliVersion",
					);
					for (const leaked of [
						"someone",
						"private",
						"secret",
						"0.0.26",
						"x.tgz",
					]) {
						assert.ok(
							!reason.includes(leaked),
							`reason for ${spec} leaks ${JSON.stringify(leaked)}: ${reason}`,
						);
					}
				}
			}
		});

		it("names a local file or link spec as a category when it is not installed", () => {
			const { repoRoot, skillRoot } = adopter();
			writeJson(join(repoRoot, "package.json"), {
				devDependencies: { "@pfdsl/cli": "file:/Users/someone/x.tgz" },
			});

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
			});

			assert.match(
				env.unavailable.find(({ field }) => field === "repoCliVersion").reason,
				/local file or link/,
			);
		});

		it("records repoCliVersion as unavailable when the installed package carries no usable version", () => {
			const { repoRoot, skillRoot } = adopter();
			writeJson(join(repoRoot, "package.json"), {
				dependencies: { "@pfdsl/cli": "^0.0.26" },
			});
			writeJson(join(repoRoot, "node_modules/@pfdsl/cli/package.json"), {
				version: "",
			});

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
			});

			assert.equal(env.repoCliVersion, null);
			assert.ok(
				env.unavailable.some(({ field }) => field === "repoCliVersion"),
			);
		});

		it("does not call an unreadable installed package.json not installed", () => {
			for (const content of ["{ broken", "null", "[]"]) {
				const { repoRoot, skillRoot } = adopter();
				writeJson(join(repoRoot, "package.json"), {
					devDependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				mkdirSync(join(repoRoot, "node_modules/@pfdsl/cli"), {
					recursive: true,
				});
				writeFileSync(
					join(repoRoot, "node_modules/@pfdsl/cli/package.json"),
					content,
				);

				const env = collectReportEnvironment(skillRoot, {
					runCommand: pathCli,
				});

				assert.equal(env.repoCliVersion, null, content);
				const { reason } = env.unavailable.find(
					({ field }) => field === "repoCliVersion",
				);
				assert.match(reason, /could not be parsed/, content);
				assert.doesNotMatch(reason, /not installed/, content);
			}
		});

		it("does not call a Yarn Plug'n'Play install not installed", () => {
			const { repoRoot, skillRoot } = adopter();
			writeJson(join(repoRoot, "package.json"), {
				devDependencies: { "@pfdsl/cli": "^0.0.26" },
			});
			writeFileSync(join(repoRoot, ".pnp.cjs"), "");

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
			});

			assert.equal(env.repoCliVersion, null);
			const { reason } = env.unavailable.find(
				({ field }) => field === "repoCliVersion",
			);
			assert.match(reason, /Plug'n'Play/);
			assert.doesNotMatch(reason, /not installed/);
		});

		it("prefers an installed node_modules package over a stray .pnp.cjs", () => {
			const { repoRoot, skillRoot } = adopter();
			writeJson(join(repoRoot, "package.json"), {
				devDependencies: { "@pfdsl/cli": "^0.0.26" },
			});
			writeFileSync(join(repoRoot, ".pnp.cjs"), "");
			writeJson(join(repoRoot, "node_modules/@pfdsl/cli/package.json"), {
				version: "0.0.26",
			});

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
			});

			assert.equal(env.repoCliVersion, "0.0.26");
		});

		// peerDependencies do not install for the adopting project, so a package
		// listing @pfdsl/cli only there has not declared a CLI of its own.
		it("does not treat peerDependencies as a declaration", () => {
			const { repoRoot, skillRoot } = adopter();
			writeJson(join(repoRoot, "package.json"), {
				peerDependencies: { "@pfdsl/cli": "^0.0.26" },
			});

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
			});

			assert.ok(!("repoCliVersion" in env));
			assert.ok(
				!env.unavailable.some(({ field }) => field === "repoCliVersion"),
			);
		});

		it("records repoCliVersion as unavailable when package.json cannot be parsed", () => {
			for (const content of ["{ broken", "null", "[]"]) {
				const { repoRoot, skillRoot } = adopter();
				writeFileSync(join(repoRoot, "package.json"), content);

				const env = collectReportEnvironment(skillRoot, {
					runCommand: pathCli,
				});

				assert.equal(env.repoCliVersion, null, content);
				const failure = env.unavailable.find(
					({ field }) => field === "repoCliVersion",
				);
				assert.ok(
					failure,
					`repoCliVersion should be unavailable for ${content}`,
				);
				assert.match(failure.reason, /could not be parsed/);
			}
		});

		it("omits repoCliVersion and its unavailable entry when the repository does not depend on @pfdsl/cli", () => {
			const { repoRoot, skillRoot } = adopter();
			writeJson(join(repoRoot, "package.json"), {
				dependencies: { "left-pad": "1.0.0" },
			});

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
			});

			assert.ok(!("repoCliVersion" in env));
			assert.ok(
				!env.unavailable.some(({ field }) => field === "repoCliVersion"),
			);
		});

		it("omits repoCliVersion when the repository has no package.json", () => {
			const { skillRoot } = adopter();

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
			});

			assert.ok(!("repoCliVersion" in env));
			assert.ok(
				!env.unavailable.some(({ field }) => field === "repoCliVersion"),
			);
		});

		// A plugin installation has no checkout above its skill root, so the
		// adopting project is wherever the collector is run from. The plugin
		// cache's own directory must never be read as that project.
		function pluginInstall(shape) {
			const skillRoot = join(tmp, "cache", "skills", "pfd-ops");
			mkdirSync(skillRoot, { recursive: true });
			writeJson(join(tmp, "cache", `.${shape}-plugin`, "plugin.json"), {
				version: "0.4.2",
			});
			return skillRoot;
		}

		for (const shape of ["claude", "codex"]) {
			it(`reads the project from the working directory's checkout for a ${shape} plugin install`, () => {
				const skillRoot = pluginInstall(shape);
				const project = join(tmp, "project");
				mkdirSync(join(project, ".git"), { recursive: true });
				mkdirSync(join(project, "packages", "app"), { recursive: true });
				writeJson(join(project, "package.json"), {
					devDependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				writeJson(join(project, "node_modules/@pfdsl/cli/package.json"), {
					version: "0.0.26",
				});

				const env = collectReportEnvironment(skillRoot, {
					runCommand: pathCli,
					cwd: join(project, "packages", "app"),
				});

				assert.equal(env.installation, `${shape}-plugin`);
				assert.equal(env.cliVersion, "0.0.25");
				assert.equal(env.repoCliVersion, "0.0.26");
			});
		}

		it("uses the working directory itself when it is not inside a checkout", () => {
			const skillRoot = pluginInstall("claude");
			const project = join(tmp, "project");
			mkdirSync(project, { recursive: true });
			writeJson(join(project, "package.json"), {
				dependencies: { "@pfdsl/cli": "^0.0.26" },
			});

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
				cwd: project,
				findRepoRootOrNull: () => null,
			});

			assert.equal(env.repoCliVersion, null);
			assert.match(
				env.unavailable.find(({ field }) => field === "repoCliVersion").reason,
				/not installed/,
			);
		});

		it("omits repoCliVersion for a plugin install run from a directory without package.json", () => {
			const skillRoot = pluginInstall("claude");
			const project = join(tmp, "project");
			mkdirSync(project, { recursive: true });

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
				cwd: project,
				findRepoRootOrNull: () => null,
			});

			assert.ok(!("repoCliVersion" in env));
			assert.ok(
				!env.unavailable.some(({ field }) => field === "repoCliVersion"),
			);
		});

		it("does not read the plugin cache as the project", () => {
			const skillRoot = pluginInstall("claude");
			writeJson(join(tmp, "cache", "package.json"), {
				dependencies: { "@pfdsl/cli": "^9.9.9" },
			});
			const project = join(tmp, "project");
			mkdirSync(project, { recursive: true });

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
				cwd: project,
				findRepoRootOrNull: () => null,
			});

			assert.ok(!("repoCliVersion" in env));
		});

		// The bundle root is never the project. A working directory inside it
		// means the collector was run from the plugin cache, where no adopting
		// project can be identified, and a package.json found there would describe
		// the bundle rather than the project.
		for (const shape of ["claude", "codex"]) {
			for (const where of [".", "skills", "skills/pfd-ops"]) {
				it(`treats a working directory at ${where} inside a ${shape} plugin bundle as no project`, () => {
					const skillRoot = pluginInstall(shape);
					const bundle = join(tmp, "cache");
					writeJson(join(bundle, "package.json"), {
						dependencies: { "@pfdsl/cli": "^9.9.9" },
					});
					writeJson(join(bundle, "node_modules/@pfdsl/cli/package.json"), {
						version: "9.9.9",
					});

					const env = collectReportEnvironment(skillRoot, {
						runCommand: pathCli,
						cwd: join(bundle, where),
						findRepoRootOrNull: () => null,
					});

					assert.equal(env.repoCliVersion, null);
					const failure = env.unavailable.find(
						({ field }) => field === "repoCliVersion",
					);
					assert.ok(
						failure,
						"repoCliVersion should be recorded as unavailable",
					);
					assert.match(failure.reason, /plugin bundle/);
					assert.doesNotMatch(failure.reason, /9\.9\.9/);
				});
			}
		}

		it("does not mistake a sibling directory that shares the bundle's name prefix for the bundle", () => {
			const skillRoot = pluginInstall("claude");
			const project = join(tmp, "cache-project");
			mkdirSync(project, { recursive: true });
			writeJson(join(project, "package.json"), {
				dependencies: { "@pfdsl/cli": "^0.0.26" },
			});
			writeJson(join(project, "node_modules/@pfdsl/cli/package.json"), {
				version: "0.0.26",
			});

			const env = collectReportEnvironment(skillRoot, {
				runCommand: pathCli,
				cwd: project,
				findRepoRootOrNull: () => null,
			});

			assert.equal(env.repoCliVersion, "0.0.26");
		});

		describe("in a monorepo", () => {
			// The project root is the checkout's top level, but the package that
			// declares @pfdsl/cli can be a workspace package below it. The nearest
			// declaring package.json from the working directory wins, and its
			// install is the nearest node_modules that holds the CLI, never
			// anything above the project root.
			function workspace() {
				const skillRoot = pluginInstall("claude");
				const project = join(tmp, "project");
				const app = join(project, "packages", "app");
				mkdirSync(join(project, ".git"), { recursive: true });
				mkdirSync(app, { recursive: true });
				return { skillRoot, project, app };
			}

			const collectFrom = (skillRoot, cwd) =>
				collectReportEnvironment(skillRoot, { runCommand: pathCli, cwd });

			it("finds a workspace package that declares @pfdsl/cli below the project root", () => {
				const { skillRoot, project, app } = workspace();
				writeJson(join(project, "package.json"), { name: "root" });
				writeJson(join(app, "package.json"), {
					devDependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				writeJson(join(project, "node_modules/@pfdsl/cli/package.json"), {
					version: "0.0.26",
				});

				const env = collectFrom(skillRoot, app);

				assert.equal(env.repoCliVersion, "0.0.26");
			});

			it("prefers the nearest declaring package.json and its own node_modules", () => {
				const { skillRoot, project, app } = workspace();
				writeJson(join(project, "package.json"), {
					devDependencies: { "@pfdsl/cli": "^2.0.0" },
				});
				writeJson(join(project, "node_modules/@pfdsl/cli/package.json"), {
					version: "2.0.0",
				});
				writeJson(join(app, "package.json"), {
					devDependencies: { "@pfdsl/cli": "^1.0.0" },
				});
				writeJson(join(app, "node_modules/@pfdsl/cli/package.json"), {
					version: "1.0.0",
				});

				const env = collectFrom(skillRoot, app);

				assert.equal(env.repoCliVersion, "1.0.0");
			});

			it("skips a nearer package.json that does not declare @pfdsl/cli", () => {
				const { skillRoot, project, app } = workspace();
				writeJson(join(app, "package.json"), { name: "app" });
				writeJson(join(project, "package.json"), {
					devDependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				writeJson(join(project, "node_modules/@pfdsl/cli/package.json"), {
					version: "0.0.26",
				});

				const env = collectFrom(skillRoot, app);

				assert.equal(env.repoCliVersion, "0.0.26");
			});

			it("resolves the install through a hoisted node_modules above the workspace package", () => {
				const { skillRoot, project, app } = workspace();
				writeJson(join(app, "package.json"), {
					dependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				writeJson(
					join(project, "packages/node_modules/@pfdsl/cli/package.json"),
					{
						version: "0.0.27",
					},
				);

				const env = collectFrom(skillRoot, app);

				assert.equal(env.repoCliVersion, "0.0.27");
			});

			it("reports Plug'n'Play when the marker sits above the declaring workspace package", () => {
				const { skillRoot, project, app } = workspace();
				writeJson(join(app, "package.json"), {
					dependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				writeFileSync(join(project, ".pnp.cjs"), "");

				const env = collectFrom(skillRoot, app);

				assert.match(
					env.unavailable.find(({ field }) => field === "repoCliVersion")
						.reason,
					/Plug'n'Play/,
				);
			});

			it("stops at the nearest package.json it cannot parse instead of guessing from a farther one", () => {
				const { skillRoot, project, app } = workspace();
				writeFileSync(join(app, "package.json"), "{ broken");
				writeJson(join(project, "package.json"), {
					devDependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				writeJson(join(project, "node_modules/@pfdsl/cli/package.json"), {
					version: "0.0.26",
				});

				const env = collectFrom(skillRoot, app);

				assert.equal(env.repoCliVersion, null);
				assert.match(
					env.unavailable.find(({ field }) => field === "repoCliVersion")
						.reason,
					/could not be parsed/,
				);
			});

			it("never reads above the project root", () => {
				const { skillRoot, app } = workspace();
				writeJson(join(tmp, "package.json"), {
					dependencies: { "@pfdsl/cli": "^9.9.9" },
				});
				writeJson(join(tmp, "node_modules/@pfdsl/cli/package.json"), {
					version: "9.9.9",
				});

				const env = collectFrom(skillRoot, app);

				assert.ok(!("repoCliVersion" in env));
			});

			it("does not use a node_modules above the project root for a declaration inside it", () => {
				const { skillRoot, project, app } = workspace();
				writeJson(join(project, "package.json"), {
					dependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				writeJson(join(tmp, "node_modules/@pfdsl/cli/package.json"), {
					version: "9.9.9",
				});

				const env = collectFrom(skillRoot, app);

				assert.equal(env.repoCliVersion, null);
				assert.match(
					env.unavailable.find(({ field }) => field === "repoCliVersion")
						.reason,
					/not installed/,
				);
			});

			it("walks from the working directory inside a repo-local install", () => {
				const { repoRoot, skillRoot } = adopter();
				const app = join(repoRoot, "packages", "app");
				mkdirSync(app, { recursive: true });
				writeJson(join(app, "package.json"), {
					devDependencies: { "@pfdsl/cli": "^0.0.26" },
				});
				writeJson(join(repoRoot, "node_modules/@pfdsl/cli/package.json"), {
					version: "0.0.26",
				});

				const env = collectFrom(skillRoot, app);

				assert.equal(env.repoCliVersion, "0.0.26");
			});
		});

		it("never runs the repo-local binary", () => {
			const { repoRoot, skillRoot } = adopter();
			writeJson(join(repoRoot, "package.json"), {
				dependencies: { "@pfdsl/cli": "^0.0.26" },
			});
			writeJson(join(repoRoot, "node_modules/@pfdsl/cli/package.json"), {
				version: "0.0.26",
			});
			const calls = [];

			collectReportEnvironment(skillRoot, {
				runCommand: (command, args) => {
					calls.push([command, ...args]);
					return null;
				},
			});

			assert.deepEqual(calls.map(([command]) => command).sort(), [
				"git",
				"pfdsl",
			]);
		});
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

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			cwd: projectDir,
		});

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

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			cwd: projectDir,
		});

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

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			cwd: projectDir,
		});

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

		const env = collectReportEnvironment(skillRoot, {
			runCommand: noCommands,
			cwd: projectDir,
		});

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
			cwd: projectDir,
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
			cwd: projectDir,
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
