import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function createFixture({
	baseType = "runtime-pipeline",
	headType = "pipeline",
} = {}) {
	const root = mkdtempSync(join(tmpdir(), "pr-diff-images-"));
	mkdirSync(join(root, "scripts", "pfdsl"), { recursive: true });
	cpSync(
		join(sourceRoot, "scripts", "generate-pr-diff-images.mjs"),
		join(root, "scripts", "generate-pr-diff-images.mjs"),
	);
	symlinkSync(
		join(sourceRoot, "scripts", "pfdsl", "lib"),
		join(root, "scripts", "pfdsl", "lib"),
	);
	mkdirSync(join(root, "packages", "cli", "dist"), { recursive: true });
	writeFileSync(
		join(root, "packages", "cli", "dist", "cli.js"),
		`#!/usr/bin/env node
import { readFileSync } from "node:fs";
const [, , command, first, second] = process.argv;
const inputs = command === "diff" ? [first, second] : [first];
for (const input of inputs) {
  const source = readFileSync(input, "utf8");
  if (source.includes("runtime-pipeline")) {
    console.error("/private/tmp/pfdsl-before-secret.pfdsl:2:1: error [V031]: Invalid type 'runtime-pipeline'. Allowed: roadmap, workflow, pipeline");
    console.error("    at render (/private/tmp/pfdsl-before-secret.pfdsl:12:3)");
    process.exit(1);
  }
}
process.stdout.write("<svg>" + command + "</svg>\\n");
`,
	);

	const bin = join(root, "bin");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "gh"),
		`#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv[3] === "view") process.stdout.write("Existing body\\n");
if (process.argv[3] === "edit") {
  const bodyIndex = process.argv.indexOf("--body");
  writeFileSync(process.env.GH_CAPTURE, process.argv[bodyIndex + 1]);
}
`,
	);
	chmodSync(join(bin, "gh"), 0o755);

	execFileSync("git", ["init", "--quiet"], { cwd: root });
	execFileSync(
		"git",
		["remote", "add", "origin", "https://github.com/example/repo.git"],
		{
			cwd: root,
		},
	);
	mkdirSync(join(root, ".pfdsl"));
	writeFileSync(
		join(root, ".pfdsl", "pipeline.pfdsl"),
		`---\ntype: ${baseType}\n---\nA >> P -> B\n`,
	);
	execFileSync("git", ["add", ".pfdsl/pipeline.pfdsl"], { cwd: root });
	execFileSync("git", ["commit", "--quiet", "-m", "base"], {
		cwd: root,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});
	const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: root,
		encoding: "utf8",
	}).trim();
	writeFileSync(
		join(root, ".pfdsl", "pipeline.pfdsl"),
		`---\ntype: ${headType}\n---\nA >> P -> B\n`,
	);

	return { root, bin, baseSha };
}

describe("generate-pr-diff-images", () => {
	it("keeps the after image and explains an unrenderable base without leaking internals", () => {
		const fixture = createFixture();
		const capture = join(fixture.root, "pr-body.txt");
		const env = {
			...process.env,
			PATH: `${fixture.bin}:${process.env.PATH}`,
			BASE_SHA: fixture.baseSha,
			PR_NUMBER: "1066",
			CHANGED_FILES: ".pfdsl/pipeline.pfdsl",
			GITHUB_REPOSITORY: "example/repo",
			GH_CAPTURE: capture,
		};
		try {
			const generate = spawnSync(
				process.execPath,
				[
					join(fixture.root, "scripts", "generate-pr-diff-images.mjs"),
					"generate",
				],
				{ cwd: fixture.root, env, encoding: "utf8" },
			);
			assert.equal(generate.status, 0, generate.stderr);

			const diagramDir = join(
				fixture.root,
				"docs",
				"diagrams",
				"pr-1066",
				".pfdsl",
			);
			assert.equal(existsSync(join(diagramDir, "pipeline.before.svg")), false);
			assert.equal(existsSync(join(diagramDir, "pipeline.diff.svg")), false);
			assert.equal(existsSync(join(diagramDir, "pipeline.after.svg")), true);

			const update = spawnSync(
				process.execPath,
				[
					join(fixture.root, "scripts", "generate-pr-diff-images.mjs"),
					"update-pr",
				],
				{ cwd: fixture.root, env, encoding: "utf8" },
			);
			assert.equal(update.status, 0, update.stderr);
			const body = readFileSync(capture, "utf8");
			assert.match(
				body,
				/Unavailable: the base revision is not accepted by the current CLI \(V031: Invalid type 'runtime-pipeline'\. Allowed: roadmap, workflow, pipeline\)/,
			);
			assert.match(body, /\*\*After\*\*/);
			assert.doesNotMatch(body, /at render|\/private\/tmp|pfdsl-before-secret/);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("keeps a head render failure fatal", () => {
		const fixture = createFixture({ headType: "runtime-pipeline" });
		try {
			const result = spawnSync(
				process.execPath,
				[
					join(fixture.root, "scripts", "generate-pr-diff-images.mjs"),
					"generate",
				],
				{
					cwd: fixture.root,
					encoding: "utf8",
					env: {
						...process.env,
						BASE_SHA: fixture.baseSha,
						PR_NUMBER: "1066",
						CHANGED_FILES: ".pfdsl/pipeline.pfdsl",
						GITHUB_REPOSITORY: "example/repo",
					},
				},
			);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /V031/);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("still generates before, after, and diff images for compatible revisions", () => {
		const fixture = createFixture({ baseType: "pipeline" });
		try {
			const result = spawnSync(
				process.execPath,
				[
					join(fixture.root, "scripts", "generate-pr-diff-images.mjs"),
					"generate",
				],
				{
					cwd: fixture.root,
					encoding: "utf8",
					env: {
						...process.env,
						BASE_SHA: fixture.baseSha,
						PR_NUMBER: "1066",
						CHANGED_FILES: ".pfdsl/pipeline.pfdsl",
						GITHUB_REPOSITORY: "example/repo",
					},
				},
			);
			assert.equal(result.status, 0, result.stderr);
			const diagramDir = join(
				fixture.root,
				"docs",
				"diagrams",
				"pr-1066",
				".pfdsl",
			);
			assert.equal(existsSync(join(diagramDir, "pipeline.before.svg")), true);
			assert.equal(existsSync(join(diagramDir, "pipeline.after.svg")), true);
			assert.equal(existsSync(join(diagramDir, "pipeline.diff.svg")), true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	it("removes stale before and diff images when a later run cannot render the base", () => {
		const fixture = createFixture({ baseType: "pipeline" });
		const env = {
			...process.env,
			BASE_SHA: fixture.baseSha,
			PR_NUMBER: "1066",
			CHANGED_FILES: ".pfdsl/pipeline.pfdsl",
			GITHUB_REPOSITORY: "example/repo",
		};
		const script = join(fixture.root, "scripts", "generate-pr-diff-images.mjs");
		try {
			assert.equal(
				spawnSync(process.execPath, [script, "generate"], { env }).status,
				0,
			);
			writeFileSync(
				join(fixture.root, ".pfdsl", "pipeline.pfdsl"),
				"---\ntype: runtime-pipeline\n---\nA >> P -> B\n",
			);
			execFileSync("git", ["add", ".pfdsl/pipeline.pfdsl"], {
				cwd: fixture.root,
			});
			execFileSync("git", ["commit", "--quiet", "--amend", "--no-edit"], {
				cwd: fixture.root,
				env: {
					...process.env,
					GIT_AUTHOR_NAME: "Test",
					GIT_AUTHOR_EMAIL: "test@example.com",
					GIT_COMMITTER_NAME: "Test",
					GIT_COMMITTER_EMAIL: "test@example.com",
				},
			});
			env.BASE_SHA = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: fixture.root,
				encoding: "utf8",
			}).trim();
			writeFileSync(
				join(fixture.root, ".pfdsl", "pipeline.pfdsl"),
				"---\ntype: pipeline\n---\nA >> P -> B\n",
			);
			assert.equal(
				spawnSync(process.execPath, [script, "generate"], { env }).status,
				0,
			);
			const diagramDir = join(
				fixture.root,
				"docs",
				"diagrams",
				"pr-1066",
				".pfdsl",
			);
			assert.equal(existsSync(join(diagramDir, "pipeline.before.svg")), false);
			assert.equal(existsSync(join(diagramDir, "pipeline.diff.svg")), false);
			assert.equal(existsSync(join(diagramDir, "pipeline.after.svg")), true);
		} finally {
			rmSync(fixture.root, { recursive: true, force: true });
		}
	});

	for (const change of ["added", "deleted"]) {
		it(`preserves ${change}-file image generation`, () => {
			const fixture = createFixture({ baseType: "pipeline" });
			const file =
				change === "added" ? ".pfdsl/added.pfdsl" : ".pfdsl/pipeline.pfdsl";
			const stem = change === "added" ? "added" : "pipeline";
			try {
				if (change === "added") {
					writeFileSync(
						join(fixture.root, file),
						"---\ntype: pipeline\n---\nA >> P -> B\n",
					);
				} else {
					rmSync(join(fixture.root, file));
				}
				const result = spawnSync(
					process.execPath,
					[
						join(fixture.root, "scripts", "generate-pr-diff-images.mjs"),
						"generate",
					],
					{
						cwd: fixture.root,
						encoding: "utf8",
						env: {
							...process.env,
							BASE_SHA: fixture.baseSha,
							PR_NUMBER: "1066",
							CHANGED_FILES: file,
							GITHUB_REPOSITORY: "example/repo",
						},
					},
				);
				assert.equal(result.status, 0, result.stderr);
				const diagramDir = join(
					fixture.root,
					"docs",
					"diagrams",
					"pr-1066",
					".pfdsl",
				);
				assert.equal(
					existsSync(join(diagramDir, `${stem}.before.svg`)),
					change === "deleted",
				);
				assert.equal(
					existsSync(join(diagramDir, `${stem}.after.svg`)),
					change === "added",
				);
				assert.equal(existsSync(join(diagramDir, `${stem}.diff.svg`)), true);
			} finally {
				rmSync(fixture.root, { recursive: true, force: true });
			}
		});
	}
});
