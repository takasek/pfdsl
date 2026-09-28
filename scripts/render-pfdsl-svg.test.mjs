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

test("render step selects only new or changed SVG files", () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-render-svg-test-"));
	try {
		mkdirSync(join(root, ".pfdsl"));
		const rendererDir = join(root, ".pfdsl-renderer/packages/cli/dist");
		mkdirSync(rendererDir, { recursive: true });
		writeFileSync(join(root, ".pfdsl/flow.pfdsl"), "artifact flow\n");
		writeFileSync(
			join(rendererDir, "cli.js"),
			"process.stdout.write(process.env.RENDERED_SVG + '\\n');\n",
		);
		const git = spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
		assert.equal(git.status, 0);
		const add = spawnSync("git", ["add", ".pfdsl/flow.pfdsl"], { cwd: root });
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

		assert.match(run("<svg>first</svg>"), /\.pfdsl\/flow\.svg/);
		assert.equal(
			readFileSync(join(root, ".pfdsl/flow.svg"), "utf8"),
			"<svg>first</svg>\n",
		);
		assert.equal(run("<svg>first</svg>"), "");
		assert.match(run("<svg>updated</svg>"), /\.pfdsl\/flow\.svg/);
		assert.equal(
			readFileSync(join(root, ".pfdsl/flow.svg"), "utf8"),
			"<svg>updated</svg>\n",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
