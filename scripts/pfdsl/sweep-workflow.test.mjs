import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workflow = parse(
	readFileSync(
		join(root, ".github/workflows/pfdsl-sweep-completed-chains.yml"),
		"utf8",
	),
);
const steps = workflow.jobs["sweep-completed-chains"].steps;

// Exercise the real detector shell in each adopter shape. Actions and package
// downloads are not a local runner: validate their selected inputs here, then
// run the real sweep with the already-built CLI. Live Actions remains a separate
// acceptance check.
for (const shape of ["no-package", "no-package-manager", "workspace"]) {
	test(`sweep workflow reaches recovery for ${shape}`, () => {
		const dir = mkdtempSync(join(tmpdir(), "sweep-workflow-"));
		try {
			if (shape !== "no-package") {
				writeFileSync(
					join(dir, "package.json"),
					JSON.stringify(
						shape === "workspace"
							? { packageManager: "pnpm@10.33.2" }
							: { private: true },
					),
				);
			}
			if (shape === "workspace") {
				writeFileSync(
					join(dir, "pnpm-workspace.yaml"),
					"packages: [packages/*]\n",
				);
				mkdirSync(join(dir, "packages/cli"), { recursive: true });
				writeFileSync(join(dir, "packages/cli/package.json"), "{}");
			}
			const output = join(dir, "step-output");
			let detected;
			let pnpmSetUp = false;
			let installation;
			let swept = false;
			for (const step of steps) {
				if (step.if) {
					const condition =
						/^steps\.detect-workspace\.outputs\.in_workspace (==|!=) 'true'$/.exec(
							step.if,
						);
					assert.ok(condition, `Unsupported fixture condition: ${step.if}`);
					if ((detected === "true") !== (condition[1] === "==")) continue;
				}
				if (step.id === "detect-workspace") {
					const result = spawnSync("bash", ["-e", "-c", step.run], {
						cwd: dir,
						encoding: "utf8",
						env: { ...process.env, GITHUB_OUTPUT: output },
					});
					assert.equal(result.status, 0, result.stderr);
					detected = /in_workspace=(true|false)/.exec(
						readFileSync(output, "utf8"),
					)?.[1];
				} else if (step.uses?.startsWith("pnpm/action-setup@")) {
					assert.equal(
						shape,
						"workspace",
						"Adopters must not execute pnpm setup",
					);
					assert.equal(
						detected,
						"true",
						"Detect the workspace before pnpm setup",
					);
					pnpmSetUp = true;
				} else if (step.id === "build-cli") {
					assert.equal(pnpmSetUp, true);
					installation = "source";
				} else if (step.id === "install-cli") {
					assert.equal(pnpmSetUp, false);
					installation = "published";
				} else if (step.run?.includes("sweep-completed-chains.mjs")) {
					assert.equal(
						installation,
						shape === "workspace" ? "source" : "published",
					);
					mkdirSync(join(dir, ".pfdsl"));
					const roadmap = join(dir, ".pfdsl/roadmap.pfdsl");
					writeFileSync(
						roadmap,
						"---\ntype: roadmap\nartifact:\n  input: { status: done }\n  output: { status: done }\nprocess:\n  work: {}\n---\ninput >> work -> output\n",
					);
					const result = spawnSync(
						process.execPath,
						[
							join(root, "scripts/pfdsl/sweep-completed-chains.mjs"),
							roadmap,
							"--write",
						],
						{
							cwd: dir,
							encoding: "utf8",
							env: {
								...process.env,
								PFDSL_CLI: join(root, "packages/cli/dist/cli.js"),
							},
						},
					);
					assert.equal(result.status, 0, result.stdout + result.stderr);
					assert.doesNotMatch(readFileSync(roadmap, "utf8"), /input >> work/);
					swept = true;
				}
			}
			assert.equal(swept, true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
