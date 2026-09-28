import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import YAML from "yaml";

const workflow = YAML.parse(
	readFileSync(
		new URL("../.github/workflows/render-pfdsl-svg.yml", import.meta.url),
		"utf8",
	),
);
const renderStep = workflow.jobs.render.steps.find(
	(step) => step.name === "Render sibling SVG files",
);
const prepareStep = workflow.jobs.publish.steps.find(
	(step) => step.name === "Prepare changed SVG files",
);

test("manual dispatch exposes regeneration inputs", () => {
	const inputs = workflow.on.workflow_dispatch?.inputs;
	assert.equal(inputs?.mode?.default, "direct");
	assert.deepEqual(inputs?.mode?.options, ["direct", "pr"]);
	assert.equal(inputs?.["target-branch"]?.default, "main");
	assert.equal(inputs?.paths?.default, ".pfdsl/**/*.pfdsl");
	assert.equal(inputs?.["cli-ref"]?.default, undefined);
});

test("App credentials are confined to a separate publish job", () => {
	const renderJob = workflow.jobs.render;
	const publishJob = workflow.jobs.publish;
	assert.equal(publishJob.needs, "render");
	assert.equal(
		renderJob.steps.some((step) =>
			step.uses?.includes("create-github-app-token"),
		),
		false,
	);
	assert.equal(
		publishJob.steps.some((step) => step.name === "Build renderer"),
		false,
	);
	assert.match(
		renderJob.steps.find((step) => step.name === "Check out renderer source")
			.with.ref,
		/job\.workflow_sha/,
	);
	const pushStep = publishJob.steps.find(
		(step) => step.name === "Push updated SVG files",
	);
	assert.match(pushStep.run, /core\.hooksPath=\/dev\/null/);
	assert.match(
		pushStep.run,
		/git -c core\.hooksPath=\/dev\/null push origin "HEAD:\$TARGET_BRANCH"/,
	);
});

test("direct mode rejects a renderer override", () => {
	const validateStep = workflow.jobs.render.steps.find(
		(step) => step.name === "Validate renderer revision",
	);
	const sha = "a".repeat(40);
	const run = (mode, override) =>
		spawnSync("bash", ["-e", "-c", validateStep.run], {
			encoding: "utf8",
			env: {
				...process.env,
				CLI_REF: sha,
				CLI_OVERRIDE: override,
				MODE: mode,
			},
		});
	assert.equal(run("direct", "").status, 0);
	assert.equal(run("pr", sha).status, 0);
	const rejected = run("direct", sha);
	assert.equal(rejected.status, 1);
	assert.match(rejected.stderr, /cli-ref overrides require PR mode/);
});

test("render step selects only new or changed SVG files", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-render-svg-test-"));
	try {
		mkdirSync(join(root, ".pfdsl"));
		const rendererDir = join(root, ".pfdsl-renderer/packages/cli/dist");
		mkdirSync(rendererDir, { recursive: true });
		writeFileSync(join(root, ".pfdsl/flow.pfdsl"), "artifact flow\n");
		writeFileSync(join(root, ".pfdsl/other.pfdsl"), "artifact other\n");
		writeFileSync(
			join(rendererDir, "cli.js"),
			"process.stdout.write(process.env.RENDERED_SVG + '\\n');\n",
		);
		const git = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
		assert.equal(git.status, 0);
		const add = spawnSync(
			"git",
			["add", ".pfdsl/flow.pfdsl", ".pfdsl/other.pfdsl"],
			{ cwd: root },
		);
		assert.equal(add.status, 0);
		const outputPath = join(root, "github-output");
		const run = (svg) => {
			writeFileSync(outputPath, "");
			rmSync(join(root, "rendered-svg"), { recursive: true, force: true });
			const result = spawnSync(
				"bash",
				["-e", "-o", "pipefail", "-c", renderStep.run],
				{
					cwd: root,
					encoding: "utf8",
					env: {
						...process.env,
						FILE_PATTERNS: ".pfdsl/**/*.pfdsl",
						GITHUB_OUTPUT: outputPath,
						RUNNER_TEMP: root,
						RENDERED_SVG: svg,
					},
				},
			);
			assert.equal(result.status, 0, result.stderr);
			return readFileSync(outputPath, "utf8");
		};

		assert.equal(run("<svg>first</svg>"), "has_changes=1\n");
		assert.equal(
			readFileSync(join(root, "rendered-svg/.pfdsl/flow.svg"), "utf8"),
			"<svg>first</svg>\n",
		);
		assert.equal(
			readFileSync(join(root, "rendered-svg/.pfdsl/other.svg"), "utf8"),
			"<svg>first</svg>\n",
		);
		assert.equal(
			readFileSync(join(root, ".pfdsl/flow.svg"), "utf8"),
			"<svg>first</svg>\n",
		);
		assert.equal(run("<svg>first</svg>"), "has_changes=0\n");
		assert.equal(run("<svg>updated</svg>"), "has_changes=1\n");
		assert.equal(
			readFileSync(join(root, ".pfdsl/flow.svg"), "utf8"),
			"<svg>updated</svg>\n",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("publish accepts only SVG artifacts for unchanged selected PFD sources", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-publish-svg-test-"));
	try {
		mkdirSync(join(root, ".pfdsl"));
		mkdirSync(join(root, "rendered-svg/.pfdsl"), { recursive: true });
		writeFileSync(join(root, ".pfdsl/flow.pfdsl"), "artifact flow\n");
		writeFileSync(
			join(root, "rendered-svg/.pfdsl/flow.svg"),
			"<svg>flow</svg>\n",
		);
		for (const args of [
			["init", "-q", "-b", "main"],
			["add", ".pfdsl/flow.pfdsl"],
			[
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-qm",
				"source",
			],
		]) {
			const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
			assert.equal(result.status, 0, result.stderr);
		}
		const sourceSha = spawnSync("git", ["rev-parse", "HEAD"], {
			cwd: root,
			encoding: "utf8",
		}).stdout.trim();
		const outputPath = join(root, "github-output");
		const prepare = () => {
			writeFileSync(outputPath, "");
			return spawnSync(
				"bash",
				["-e", "-o", "pipefail", "-c", prepareStep.run],
				{
					cwd: root,
					encoding: "utf8",
					env: {
						...process.env,
						FILE_PATTERNS: ".pfdsl/**/*.pfdsl",
						GITHUB_OUTPUT: outputPath,
						GITHUB_WORKSPACE: root,
						RUNNER_TEMP: root,
						SOURCE_SHA: sourceSha,
					},
				},
			);
		};
		const first = prepare();
		assert.equal(first.status, 0, first.stderr);
		assert.match(readFileSync(outputPath, "utf8"), /\.pfdsl\/flow\.svg/);
		assert.equal(
			readFileSync(join(root, ".pfdsl/flow.svg"), "utf8"),
			"<svg>flow</svg>\n",
		);
		const unchanged = prepare();
		assert.equal(unchanged.status, 0, unchanged.stderr);
		assert.equal(readFileSync(outputPath, "utf8"), "");
		writeFileSync(join(root, "rendered-svg/.pfdsl/unselected.svg"), "<svg/>\n");
		const unexpected = prepare();
		assert.equal(unexpected.status, 1);
		assert.match(unexpected.stderr, /Unexpected SVG artifact path/);
		rmSync(join(root, "rendered-svg/.pfdsl/unselected.svg"));
		writeFileSync(join(root, ".pfdsl/flow.pfdsl"), "artifact changed\n");
		const addChange = spawnSync("git", ["add", ".pfdsl/flow.pfdsl"], {
			cwd: root,
		});
		assert.equal(addChange.status, 0);
		const commitChange = spawnSync(
			"git",
			[
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.com",
				"commit",
				"-qm",
				"changed source",
			],
			{ cwd: root },
		);
		assert.equal(commitChange.status, 0);
		const changed = prepare();
		assert.equal(changed.status, 1);
		assert.match(changed.stderr, /PFD files changed during rendering/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("direct push catches up with an unrelated branch update", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-push-svg-test-"));
	try {
		const origin = join(root, "origin.git");
		const producer = join(root, "producer");
		const publisher = join(root, "publisher");
		const other = join(root, "other");
		const git = (cwd, args) => {
			const result = spawnSync("git", args, { cwd, encoding: "utf8" });
			assert.equal(result.status, 0, result.stderr);
			return result.stdout.trim();
		};
		mkdirSync(producer);
		git(root, ["init", "-q", "--bare", "-b", "main", origin]);
		git(producer, ["init", "-q", "-b", "main"]);
		mkdirSync(join(producer, ".pfdsl"));
		writeFileSync(join(producer, ".pfdsl/flow.pfdsl"), "artifact flow\n");
		git(producer, ["add", ".pfdsl/flow.pfdsl"]);
		git(producer, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-qm",
			"source",
		]);
		const sourceSha = git(producer, ["rev-parse", "HEAD"]);
		git(producer, ["remote", "add", "origin", origin]);
		git(producer, ["push", "-q", "origin", "main"]);
		git(root, ["clone", "-q", origin, publisher]);
		git(root, ["clone", "-q", origin, other]);
		writeFileSync(join(other, "README.md"), "Unrelated update\n");
		git(other, ["add", "README.md"]);
		git(other, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-qm",
			"unrelated",
		]);
		git(other, ["push", "-q", "origin", "main"]);
		mkdirSync(join(publisher, "rendered-svg/.pfdsl"), { recursive: true });
		writeFileSync(
			join(publisher, "rendered-svg/.pfdsl/flow.svg"),
			"<svg>flow</svg>\n",
		);
		const binDir = join(root, "bin");
		mkdirSync(binDir);
		writeFileSync(
			join(binDir, "gh"),
			'#!/bin/sh\nif [ "$1" = api ]; then echo 1234; fi\n',
		);
		chmodSync(join(binDir, "gh"), 0o755);
		const realGit = spawnSync("which", ["git"], {
			encoding: "utf8",
		}).stdout.trim();
		const raceFlag = join(root, "race-triggered");
		writeFileSync(
			join(binDir, "git"),
			'#!/bin/sh\nif [ "$*" = "-c core.hooksPath=/dev/null push origin HEAD:main" ] && [ ! -e "$RACE_FLAG" ]; then\n' +
				'  touch "$RACE_FLAG"\n' +
				'  printf "Race update\\n" >> "$RACE_OTHER/README.md"\n' +
				'  "$REAL_GIT" -C "$RACE_OTHER" add README.md\n' +
				'  "$REAL_GIT" -C "$RACE_OTHER" -c user.name=Test -c user.email=test@example.com commit -qm race\n' +
				'  "$REAL_GIT" -C "$RACE_OTHER" push -q origin main\n' +
				'fi\nexec "$REAL_GIT" "$@"\n',
		);
		chmodSync(join(binDir, "git"), 0o755);
		const pushStep = workflow.jobs.publish.steps.find(
			(step) => step.name === "Push updated SVG files",
		);
		const push = () =>
			spawnSync("bash", ["-e", "-o", "pipefail", "-c", pushStep.run], {
				cwd: publisher,
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${binDir}:${process.env.PATH}`,
					APP_SLUG: "test-app",
					FILE_PATTERNS: ".pfdsl/**/*.pfdsl",
					GITHUB_WORKSPACE: publisher,
					GH_TOKEN: "test-token",
					RUNNER_TEMP: publisher,
					REAL_GIT: realGit,
					RACE_FLAG: raceFlag,
					RACE_OTHER: other,
					SOURCE_SHA: sourceSha,
					SVG_PATHS: ".pfdsl/flow.svg",
					TARGET_BRANCH: "main",
				},
			});
		const result = push();
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stderr, /\[rejected\]/);
		assert.equal(readFileSync(raceFlag, "utf8"), "");
		assert.equal(
			git(publisher, ["show", "origin/main:README.md"]),
			"Unrelated update\nRace update",
		);
		assert.equal(
			git(publisher, ["show", "HEAD:.pfdsl/flow.svg"]),
			"<svg>flow</svg>",
		);
		git(other, ["pull", "-q", "--ff-only", "origin", "main"]);
		writeFileSync(join(other, ".pfdsl/flow.pfdsl"), "artifact changed\n");
		git(other, ["add", ".pfdsl/flow.pfdsl"]);
		git(other, [
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-qm",
			"changed source",
		]);
		git(other, ["push", "-q", "origin", "main"]);
		const stale = push();
		assert.equal(stale.status, 1);
		assert.match(stale.stderr, /PFD files changed during rendering/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
