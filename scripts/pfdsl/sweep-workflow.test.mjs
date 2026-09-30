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

const CONFIG_PATH = ".pfdsl/config.json";
const ENABLED_CONFIG = JSON.stringify({
	sweepCompletedChains: { enabled: true },
});

function writeConfig(dir, text) {
	mkdirSync(join(dir, ".pfdsl"), { recursive: true });
	writeFileSync(join(dir, CONFIG_PATH), text);
}

// Evaluate the step conditions this workflow uses: `&&`-joined comparisons of
// earlier steps' outputs. A skipped or unset output reads as the empty string,
// as it does on a runner.
function conditionHolds(condition, outputs) {
	return condition.split(" && ").every((term) => {
		const match = /^steps\.([\w-]+)\.outputs\.(\w+) (==|!=) '([^']*)'$/.exec(
			term,
		);
		assert.ok(match, `Unsupported fixture condition: ${condition}`);
		const actual = outputs[match[1]]?.[match[2]] ?? "";
		return (actual === match[4]) === (match[3] === "==");
	});
}

// Run one `run:` step under bash the way a runner does, in dir, and collect
// what it wrote to GITHUB_OUTPUT.
function runShellStep(step, dir) {
	const outputFile = join(dir, `step-output-${step.id}`);
	writeFileSync(outputFile, "");
	const result = spawnSync("bash", ["-e", "-c", step.run], {
		cwd: dir,
		encoding: "utf8",
		env: { ...process.env, GITHUB_OUTPUT: outputFile },
	});
	const outputs = {};
	for (const line of readFileSync(outputFile, "utf8").split("\n")) {
		const eq = line.indexOf("=");
		if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
	}
	return { result, outputs };
}

// Walk the workflow in dir without a runner: execute the detector steps for
// real and record which other steps their conditions let through.
function walkWorkflow(dir) {
	const outputs = {};
	const ran = [];
	let failed;
	for (const step of steps) {
		if (step.if && !conditionHolds(step.if, outputs)) continue;
		if (step.id === "sweep-gate" || step.id === "detect-workspace") {
			const { result, outputs: own } = runShellStep(step, dir);
			outputs[step.id] = own;
			if (result.status !== 0) {
				failed = { step: step.id, result };
				break;
			}
			continue;
		}
		ran.push(step.uses ?? step.name);
	}
	return { ran, outputs, failed };
}

const gateStep = steps.find((step) => step.id === "sweep-gate");

test("the opt-in gate is the step right after checkout, before any setup", () => {
	assert.ok(gateStep, "the workflow must declare a step with id sweep-gate");
	assert.match(steps[0].uses, /^actions\/checkout@/);
	assert.equal(steps[1], gateStep);
	assert.equal(gateStep.if, undefined);
});

test("every step after the gate is conditioned on the opt-in", () => {
	for (const step of steps.slice(2)) {
		assert.match(
			step.if ?? "",
			/steps\.sweep-gate\.outputs\.enabled == 'true'/,
			`step "${step.name ?? step.uses}" would run in a repository that has not opted in`,
		);
	}
});

// [label, config file text (null = file absent)]
const DISABLED_CONFIGS = [
	["file absent", null],
	["empty object", "{}"],
	["key absent (other keys only)", '{"other": {"enabled": true}}'],
	["sweepCompletedChains empty", '{"sweepCompletedChains": {}}'],
	["enabled false", '{"sweepCompletedChains": {"enabled": false}}'],
	[
		'enabled the string "true"',
		'{"sweepCompletedChains": {"enabled": "true"}}',
	],
	["enabled the number 1", '{"sweepCompletedChains": {"enabled": 1}}'],
	["enabled null", '{"sweepCompletedChains": {"enabled": null}}'],
];

const ENABLED_CONFIGS = [
	["exactly the opt-in", ENABLED_CONFIG],
	[
		"opt-in beside other keys",
		'{"other": [1, 2], "sweepCompletedChains": {"enabled": true, "extra": "x"}}',
	],
];

const BROKEN_CONFIGS = [
	["malformed JSON", "{"],
	["empty file", ""],
	["top level null", "null"],
	["top level array", "[]"],
	["top level string", '"x"'],
	["top level number", "1"],
	["top level boolean", "true"],
	["sweepCompletedChains null", '{"sweepCompletedChains": null}'],
	["sweepCompletedChains array", '{"sweepCompletedChains": []}'],
	["sweepCompletedChains boolean", '{"sweepCompletedChains": true}'],
	["sweepCompletedChains string", '{"sweepCompletedChains": "yes"}'],
	["sweepCompletedChains number", '{"sweepCompletedChains": 1}'],
];

function inTempDir(body) {
	const dir = mkdtempSync(join(tmpdir(), "sweep-gate-"));
	try {
		body(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

for (const [label, text] of DISABLED_CONFIGS) {
	test(`gate disables the sweep and every later step is skipped: ${label}`, () => {
		inTempDir((dir) => {
			if (text !== null) writeConfig(dir, text);
			const { ran, outputs, failed } = walkWorkflow(dir);
			assert.equal(failed, undefined, failed?.result.stderr);
			assert.equal(outputs["sweep-gate"].enabled, "false");
			assert.equal(ran.length, 1, `steps that ran: ${ran.join(", ")}`);
			assert.match(ran[0], /^actions\/checkout@/);
			const { result } = runShellStep(gateStep, dir);
			assert.equal(result.status, 0, result.stderr);
			const notice = /^::notice::(.*)$/m.exec(result.stdout)?.[1];
			assert.ok(notice, `expected a ::notice:: line, got: ${result.stdout}`);
			assert.match(notice, /disabled/);
			assert.ok(notice.includes(CONFIG_PATH), notice);
			assert.ok(notice.includes("sweepCompletedChains"), notice);
			assert.doesNotMatch(result.stdout, /::error::/);
		});
	});
}

for (const [label, text] of ENABLED_CONFIGS) {
	test(`gate lets the sweep proceed: ${label}`, () => {
		inTempDir((dir) => {
			writeConfig(dir, text);
			const { ran, outputs, failed } = walkWorkflow(dir);
			assert.equal(failed, undefined, failed?.result.stderr);
			assert.equal(outputs["sweep-gate"].enabled, "true");
			assert.ok(ran.length > 1, `steps that ran: ${ran.join(", ")}`);
			const { result } = runShellStep(gateStep, dir);
			assert.doesNotMatch(result.stdout, /::(notice|error)::/);
		});
	});
}

for (const [label, text] of BROKEN_CONFIGS) {
	test(`gate fails the job on a broken declaration: ${label}`, () => {
		inTempDir((dir) => {
			writeConfig(dir, text);
			const { result, outputs } = runShellStep(gateStep, dir);
			assert.notEqual(result.status, 0, result.stdout);
			const error = /^::error::(.*)$/m.exec(result.stdout)?.[1];
			assert.ok(error, `expected an ::error:: line, got: ${result.stdout}`);
			assert.ok(error.includes(CONFIG_PATH), error);
			assert.equal(outputs.enabled, undefined);
			const walked = walkWorkflow(dir);
			assert.equal(walked.failed?.step, "sweep-gate");
			assert.equal(walked.ran.length, 1);
		});
	});
}

// Exercise the real detector shell in each adopter shape. Actions and package
// downloads are not a local runner: validate their selected inputs here, then
// run the real sweep with the already-built CLI. Live Actions remains a separate
// acceptance check.
for (const shape of ["no-package", "no-package-manager", "workspace"]) {
	test(`sweep workflow selects setup for ${shape} and sweeps with the local CLI build`, () => {
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
			writeConfig(dir, ENABLED_CONFIG);
			const outputs = {};
			let pnpmSetUp = false;
			let installation;
			let swept = false;
			for (const step of steps) {
				if (step.if && !conditionHolds(step.if, outputs)) continue;
				if (step.id === "sweep-gate" || step.id === "detect-workspace") {
					const { result, outputs: own } = runShellStep(step, dir);
					assert.equal(result.status, 0, result.stderr);
					outputs[step.id] = own;
				} else if (step.uses?.startsWith("pnpm/action-setup@")) {
					assert.equal(
						shape,
						"workspace",
						"Adopters must not execute pnpm setup",
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
