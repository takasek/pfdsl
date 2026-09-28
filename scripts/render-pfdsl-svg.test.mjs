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

test("manual dispatch exposes regeneration inputs", () => {
	const inputs = workflow.on.workflow_dispatch?.inputs;
	assert.equal(inputs?.mode?.default, "direct");
	assert.deepEqual(inputs?.mode?.options, ["direct", "pr"]);
	assert.equal(inputs?.["target-branch"]?.default, "main");
	assert.equal(inputs?.paths?.default, ".pfdsl/**/*.pfdsl");
	assert.equal(inputs?.["cli-ref"]?.default, "main");
});

test("direct push reads the target branch from the environment", () => {
	const pushStep = workflow.jobs.render.steps.find(
		(step) => step.name === "Push updated SVG files",
	);
	assert.equal(
		pushStep.env.TARGET_BRANCH,
		"$" + "{{ inputs.target-branch || 'main' }}",
	);
	assert.match(pushStep.run, /git push origin "HEAD:\$TARGET_BRANCH"/);
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

		const firstOutput = run("<svg>first</svg>");
		assert.match(firstOutput, /\.pfdsl\/flow\.svg/);
		assert.match(firstOutput, /\.pfdsl\/other\.svg/);
		assert.equal(
			readFileSync(join(root, ".pfdsl/flow.svg"), "utf8"),
			"<svg>first</svg>\n",
		);
		assert.equal(run("<svg>first</svg>"), "");
		const updatedOutput = run("<svg>updated</svg>");
		assert.match(updatedOutput, /\.pfdsl\/flow\.svg/);
		assert.match(updatedOutput, /\.pfdsl\/other\.svg/);
		assert.equal(
			readFileSync(join(root, ".pfdsl/flow.svg"), "utf8"),
			"<svg>updated</svg>\n",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
