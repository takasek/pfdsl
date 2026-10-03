import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("generator recovery diagnostics", () => {
	for (const entrypoint of [
		"gen-plugin.mjs",
		"gen-plugin-dist-independent.mjs",
	]) {
		it(`preserves recovery data and reports it on failure and retry through ${entrypoint}`, () => {
			const root = mkdtempSync(join(tmpdir(), "pfdsl-recovery-cli-"));
			try {
				const paths = execFileSync(
					"git",
					[
						"ls-files",
						"-z",
						"--",
						"scripts",
						".claude",
						".pfdsl",
						"hooks",
						"generated",
						"plugin",
						".claude-plugin",
						"docs",
						".github",
						".gitignore",
						"AGENTS.md",
						"CLAUDE.md",
						".agents",
						".codex",
						"package.json",
						"packages",
					],
					{ cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 },
				)
					.split("\0")
					.filter(Boolean);
				for (const path of new Set(paths)) {
					mkdirSync(dirname(join(root, path)), { recursive: true });
					cpSync(join(repo, path), join(root, path), {
						recursive: true,
						verbatimSymlinks: true,
					});
				}
				cpSync(join(repo, "scripts"), join(root, "scripts"), {
					recursive: true,
				});
				symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
				symlinkSync(
					join(repo, "packages/core/node_modules"),
					join(root, "packages/core/node_modules"),
				);
				if (!existsSync(join(root, ".claude/skills/pfdsl")))
					symlinkSync(
						"../../generated/skills/pfdsl",
						join(root, ".claude/skills/pfdsl"),
					);
				for (const name of [
					"core",
					"cli",
					"graphviz-exporter",
					"metadata-exporter",
					"preview-engine",
				]) {
					mkdirSync(join(root, "packages", name), { recursive: true });
					symlinkSync(
						join(repo, "packages", name, "dist"),
						join(root, "packages", name, "dist"),
					);
				}
				execFileSync("git", ["init", "--quiet"], { cwd: root });
				execFileSync("git", ["add", "."], { cwd: root });
				execFileSync("git", ["ls-files", "--error-unmatch", "AGENTS.md"], {
					cwd: root,
				});
				const injection = join(root, "inject.mjs");
				writeFileSync(
					injection,
					`import fs from "node:fs";\nimport { syncBuiltinESMExports } from "node:module";\nconst copy = fs.cpSync;\nconst rename = fs.renameSync;\nfs.cpSync = (from, to, ...args) => { if (String(to).includes(".codex-tmp-") && String(to).includes("skills")) throw new Error("injected primary assembly failure"); return copy(from, to, ...args); };\nfs.renameSync = (from, to, ...args) => { if (String(from).includes(".pfdsl-gen-txn-") && String(from).endsWith("/plugin-root")) throw new Error("injected restoration failure"); return rename(from, to, ...args); };\nsyncBuiltinESMExports();\n`,
				);
				const failed = spawnSync(
					process.execPath,
					["--import", injection, join(root, "scripts", entrypoint)],
					{ cwd: root, encoding: "utf8" },
				);
				assert.equal(failed.status, 1, failed.stdout + failed.stderr);
				assert.match(failed.stderr, /injected primary assembly failure/);
				const transactions = readdirSync(join(root, "plugin")).filter((name) =>
					name.startsWith(".pfdsl-gen-txn-"),
				);
				assert.equal(transactions.length, 1);
				const snapshot = join(root, "plugin", transactions[0]);
				assert.ok(
					existsSync(join(snapshot, "plugin-root/skills/pfd-ops/SKILL.md")),
				);
				const saved = readFileSync(
					join(snapshot, "plugin-root/skills/pfd-ops/SKILL.md"),
					"utf8",
				);
				assert.match(failed.stderr, /Rollback restoration did not complete/);
				assert.ok(failed.stderr.includes(snapshot), failed.stderr);
				console.info(failed.stderr.trim());

				const retry = spawnSync(
					process.execPath,
					[join(root, "scripts", entrypoint)],
					{ cwd: root, encoding: "utf8" },
				);
				assert.equal(retry.status, 0, retry.stdout + retry.stderr);
				assert.match(retry.stderr, /Generator transaction data remain/);
				assert.ok(retry.stderr.includes(snapshot));
				console.info(retry.stderr.trim());
				assert.equal(
					readFileSync(
						join(snapshot, "plugin-root/skills/pfd-ops/SKILL.md"),
						"utf8",
					),
					saved,
				);
				execFileSync(
					"git",
					[
						"add",
						"--",
						"AGENTS.md",
						"CLAUDE.md",
						"generated",
						"plugin/pfdsl",
						"plugin/pfdsl-codex",
						".agents",
						".codex",
						".claude-plugin",
						".claude/skills/pfd-ops/install",
					],
					{ cwd: root },
				);
				execFileSync("git", ["diff", "--quiet"], { cwd: root });

				for (const trackedDrift of [false, true]) {
					if (trackedDrift)
						writeFileSync(join(root, "AGENTS.md"), "tracked drift\n");
					const drift = spawnSync(
						process.execPath,
						[
							join(root, "scripts/check-generated-drift.mjs"),
							"--gen-plugin",
							"terminal",
						],
						{ cwd: root, encoding: "utf8" },
					);
					assert.equal(drift.status, 1);
					assert.match(drift.stderr, /Generator transaction data remain/);
					assert.ok(drift.stderr.includes(snapshot));
					assert.match(
						drift.stderr,
						trackedDrift
							? /Tracked generated files differ/
							: /Untracked generated files/,
					);
				}
				const gateRetry = spawnSync(
					process.execPath,
					[join(root, "scripts/check-drift-gates.mjs")],
					{ cwd: root, encoding: "utf8" },
				);
				assert.equal(gateRetry.status, 1, gateRetry.stdout + gateRetry.stderr);
				assert.match(gateRetry.stderr, /Generator transaction data remain/);
				assert.ok(gateRetry.stderr.includes(snapshot), gateRetry.stderr);
				assert.equal(
					readFileSync(
						join(snapshot, "plugin-root/skills/pfd-ops/SKILL.md"),
						"utf8",
					),
					saved,
				);

				const gateFailure = spawnSync(
					process.execPath,
					[join(root, "scripts/check-drift-gates.mjs")],
					{
						cwd: root,
						encoding: "utf8",
						env: { ...process.env, NODE_OPTIONS: `--import=${injection}` },
					},
				);
				assert.equal(
					gateFailure.status,
					1,
					gateFailure.stdout + gateFailure.stderr,
				);
				assert.match(gateFailure.stderr, /injected primary assembly failure/);
				assert.match(
					gateFailure.stderr,
					/Rollback restoration did not complete/,
				);
				assert.equal(
					readFileSync(
						join(snapshot, "plugin-root/skills/pfd-ops/SKILL.md"),
						"utf8",
					),
					saved,
				);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	}
});
