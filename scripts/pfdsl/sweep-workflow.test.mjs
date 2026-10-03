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

// Evaluate the step conditions this workflow uses: `&&`-joined comparisons of earlier steps' outputs or outcomes, repository variables, and `failure()`.
// A skipped or unset output or variable reads as the empty string, and a step that never ran has the outcome `skipped`, as on a runner.
function conditionHolds(
	condition,
	outputs,
	vars = {},
	state = { outcomes: {}, failed: false },
) {
	return condition.split(" && ").every((term) => {
		if (term === "failure()") return state.failed;
		const outcome = /^steps\.([\w-]+)\.outcome (==|!=) '([^']*)'$/.exec(term);
		if (outcome) {
			const actual = state.outcomes[outcome[1]] ?? "skipped";
			return (actual === outcome[3]) === (outcome[2] === "==");
		}
		const match =
			/^(?:steps\.([\w-]+)\.outputs\.(\w+)|vars\.(\w+)) (==|!=) '([^']*)'$/.exec(
				term,
			);
		assert.ok(match, `Unsupported fixture condition: ${condition}`);
		const actual =
			(match[3] === undefined
				? outputs[match[1]]?.[match[2]]
				: vars[match[3]]) ?? "";
		return (actual === match[5]) === (match[4] === "==");
	});
}

// Run one `run:` step under bash the way a runner does, in dir, and collect
// what it wrote to GITHUB_OUTPUT.
function runShellStep(step, dir, extraEnv = {}) {
	const outputFile = join(dir, `step-output-${step.id}`);
	writeFileSync(outputFile, "");
	const result = spawnSync("bash", ["-e", "-c", step.run], {
		cwd: dir,
		encoding: "utf8",
		env: { ...process.env, GITHUB_OUTPUT: outputFile, ...extraEnv },
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
// failAt names (by id, else name) one step that is made to fail when it runs.
// As on a runner, a step after a failure runs only if its condition uses a status function.
function walkWorkflow(dir, vars = {}, failAt) {
	const outputs = {};
	const outcomes = {};
	const state = { outcomes, failed: false };
	const ran = [];
	let failed;
	for (const step of steps) {
		const usesStatusFunction = /\b(failure|always)\(\)/.test(step.if ?? "");
		if (state.failed && !usesStatusFunction) continue;
		if (step.if && !conditionHolds(step.if, outputs, vars, state)) continue;
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
		const fails = failAt !== undefined && (step.id ?? step.name) === failAt;
		if (step.id) outcomes[step.id] = fails ? "failure" : "success";
		if (fails) state.failed = true;
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

// GitHub holds the `pull_request` runs of a PR opened with GITHUB_TOKEN in an approval-required state ("Triggering a workflow" in the Actions docs).
// The docs name a GitHub App installation token and a personal access token as the ways past that; this repository uses an App because it already mints App tokens for other workflows.
// The sweep opens that PR, so it mints the App token when the repository configured an App, and falls back to GITHUB_TOKEN for adopters that did not.
const APP_CLIENT_ID_VAR = "PFDSL_SWEEP_APP_CLIENT_ID";
const APP_PRIVATE_KEY_SECRET = "PFDSL_SWEEP_APP_PRIVATE_KEY";
const appTokenStep = steps.find((step) => step.id === "app-token");
const openPrStep = steps.find((step) =>
	step.uses?.startsWith("peter-evans/create-pull-request@"),
);

function mintedAppToken(ran) {
	return ran.some((entry) =>
		entry.startsWith("actions/create-github-app-token@"),
	);
}

// Evaluate the one expression shape the token input uses: `${{ a.b || c.d }}`,
// each side a dotted context path. A missing or empty value is falsy, as it is
// on a runner.
function resolveFallbackExpression(expression, context) {
	const match = /^\$\{\{ ([\w.-]+) \|\| ([\w.-]+) \}\}$/.exec(expression);
	assert.ok(match, `Unsupported fixture expression: ${expression}`);
	const lookup = (path) =>
		path.split(".").reduce((value, key) => value?.[key], context);
	return lookup(match[1]) || lookup(match[2]);
}

test("the App token step reads the configured App and asks for no more than the sweep needs", () => {
	assert.ok(appTokenStep, "the workflow must declare a step with id app-token");
	assert.match(appTokenStep.uses, /^actions\/create-github-app-token@/);
	assert.equal(
		appTokenStep.with["client-id"],
		`\${{ vars.${APP_CLIENT_ID_VAR} }}`,
	);
	assert.equal(
		appTokenStep.with["private-key"],
		`\${{ secrets.${APP_PRIVATE_KEY_SECRET} }}`,
	);
	// The sweep rewrites .pfdsl/roadmap.pfdsl and opens a PR, nothing else.
	const permissions = Object.keys(appTokenStep.with)
		.filter((key) => key.startsWith("permission-"))
		.sort();
	assert.deepEqual(permissions, [
		"permission-contents",
		"permission-pull-requests",
	]);
	for (const key of permissions) assert.equal(appTokenStep.with[key], "write");
	// A failing mint must stop the job: continuing would open the PR with GITHUB_TOKEN unnoticed.
	assert.equal(appTokenStep["continue-on-error"], undefined);
	// Without owner and repositories the token is scoped to this repository only.
	assert.equal(appTokenStep.with.owner, undefined);
	assert.equal(appTokenStep.with.repositories, undefined);
});

// A push to the PR branch with the App token starts the push trigger.
// That run would queue in the flow-sync concurrency group and replace a pending run for a default-branch push, losing that sweep.
test("a push to the sweep's own PR branch does not start the sweep", () => {
	const push = workflow.on?.push;
	assert.ok(push, "the workflow must declare a push trigger");
	assert.deepEqual(push["branches-ignore"], [openPrStep.with.branch]);
	assert.equal(push.branches, undefined);
});

// [label, config text, vars, expect the App token minted]
const APP_TOKEN_CASES = [
	[
		"opted in and the App configured",
		ENABLED_CONFIG,
		{ [APP_CLIENT_ID_VAR]: "Iv1.abc" },
		true,
	],
	["opted in, no App configured", ENABLED_CONFIG, {}, false],
	[
		"opted in, App variable empty",
		ENABLED_CONFIG,
		{ [APP_CLIENT_ID_VAR]: "" },
		false,
	],
	[
		"not opted in, App configured",
		'{"sweepCompletedChains": {"enabled": false}}',
		{ [APP_CLIENT_ID_VAR]: "Iv1.abc" },
		false,
	],
];

for (const [label, text, vars, minted] of APP_TOKEN_CASES) {
	test(`the App token is ${minted ? "minted before the PR is opened" : "not minted"}: ${label}`, () => {
		inTempDir((dir) => {
			writeConfig(dir, text);
			const { ran, failed } = walkWorkflow(dir, vars);
			assert.equal(failed, undefined, failed?.result.stderr);
			assert.equal(
				mintedAppToken(ran),
				minted,
				`steps that ran: ${ran.join(", ")}`,
			);
			if (minted) {
				const mintAt = ran.findIndex((entry) =>
					entry.startsWith("actions/create-github-app-token@"),
				);
				const openAt = ran.findIndex((entry) =>
					entry.startsWith("peter-evans/create-pull-request@"),
				);
				assert.ok(openAt > mintAt, `steps that ran: ${ran.join(", ")}`);
			}
		});
	});
}

test("the PR is opened with the App token, and with GITHUB_TOKEN when no App minted one", () => {
	const expression = openPrStep.with.token;
	assert.ok(expression, "create-pull-request must be given a token input");
	const githubToken = "workflow-github-token";
	assert.equal(
		resolveFallbackExpression(expression, {
			steps: { "app-token": { outputs: { token: "app-installation-token" } } },
			github: { token: githubToken },
		}),
		"app-installation-token",
	);
	assert.equal(
		resolveFallbackExpression(expression, {
			steps: {},
			github: { token: githubToken },
		}),
		githubToken,
	);
});

test("the PR body says whether this repository's CI ran, matching the token that opened the PR", () => {
	const body = openPrStep.with.body;
	assert.doesNotMatch(body, /does not trigger/);
	const note =
		/\$\{\{ steps\.app-token\.outcome == 'success' && '([^']*)' \|\| '([^']*)' \}\}/.exec(
			body,
		);
	assert.ok(note, "the body must pick its CI note by the app-token outcome");
	const [, withApp, withoutApp] = note;
	assert.match(withApp, /without waiting for approval/);
	assert.match(withoutApp, /GITHUB_TOKEN/);
	assert.match(withoutApp, /until someone with write access approves/);
	// A reviewer who sees the held runs must find the two settings that avoid the hold.
	assert.ok(withoutApp.includes(APP_CLIENT_ID_VAR), withoutApp);
	assert.ok(withoutApp.includes(APP_PRIVATE_KEY_SECRET), withoutApp);
});

// The PR step can fail after the sweep succeeded and the branch was pushed, for example when the repository does not allow Actions to create pull requests.
// The workflow cannot read that setting beforehand: the REST endpoint needs Administration read, which GITHUB_TOKEN cannot be granted.
// So a step after the PR step explains the failure, and the job still ends failed.
const failureNotice = steps.find((step) => step.id === "pr-failure-notice");
const PR_STEP_ID = "open-pr";

test("the PR step has an id and the failure notice follows it", () => {
	assert.equal(openPrStep.id, PR_STEP_ID);
	assert.ok(
		failureNotice,
		"the workflow must declare a pr-failure-notice step",
	);
	assert.ok(steps.indexOf(failureNotice) > steps.indexOf(openPrStep));
});

test("neither the PR step nor the notice swallows the failure, so the job ends failed", () => {
	assert.equal(openPrStep["continue-on-error"], undefined);
	assert.equal(failureNotice["continue-on-error"], undefined);
});

// [label, failing step (id, else name), vars, expect the notice to run]
const NOTICE_CASES = [
	["the PR step fails", PR_STEP_ID, {}, true],
	[
		"the PR step fails after the App token minted",
		PR_STEP_ID,
		{ [APP_CLIENT_ID_VAR]: "Iv1.abc" },
		true,
	],
	["nothing fails", undefined, {}, false],
	[
		"the sweep fails before the PR step",
		"Sweep completed chains out of the roadmap",
		{},
		false,
	],
	[
		"the App token cannot be minted",
		"app-token",
		{ [APP_CLIENT_ID_VAR]: "Iv1.abc" },
		false,
	],
];

for (const [label, failAt, vars, runs] of NOTICE_CASES) {
	test(`the failure notice ${runs ? "runs" : "does not run"} when ${label}`, () => {
		inTempDir((dir) => {
			writeConfig(dir, ENABLED_CONFIG);
			const { ran, failed } = walkWorkflow(dir, vars, failAt);
			assert.equal(failed, undefined, failed?.result.stderr);
			assert.equal(
				ran.includes(failureNotice.name),
				runs,
				`steps that ran: ${ran.join(", ")}`,
			);
		});
	});
}

// Evaluate the one expression shape the notice's env uses: `${{ a.b.c }}`, a dotted context path.
function resolveContextExpression(expression, context) {
	const match = /^\$\{\{ ([\w.-]+) \}\}$/.exec(expression);
	assert.ok(match, `Unsupported fixture expression: ${expression}`);
	return (
		match[1].split(".").reduce((value, key) => value?.[key], context) ?? ""
	);
}

// Run the notice for real under bash with the env a runner would give it, and return its single annotation.
function runFailureNotice(appTokenOutcome, defaultBranch = "main") {
	const context = {
		steps: { "app-token": { outcome: appTokenOutcome } },
		github: {
			server_url: "https://github.example",
			repository: "octo/repo",
			event: { repository: { default_branch: defaultBranch } },
		},
	};
	const env = Object.fromEntries(
		Object.entries(failureNotice.env ?? {}).map(([key, expression]) => [
			key,
			resolveContextExpression(expression, context),
		]),
	);
	let outcome;
	inTempDir((dir) => {
		outcome = runShellStep(failureNotice, dir, env).result;
	});
	assert.equal(outcome.status, 0, outcome.stderr);
	const annotations = outcome.stdout
		.split("\n")
		.filter((line) => line.startsWith("::error::"));
	assert.equal(annotations.length, 1, outcome.stdout);
	return annotations[0].slice("::error::".length).replaceAll("%0A", "\n");
}

const SETTING_PATH = "Settings → Actions → General → Workflow permissions";
const SETTING_NAME = "Allow GitHub Actions to create and approve pull requests";

for (const outcome of ["skipped", "failure", "cancelled"]) {
	test(`the notice for a PR opened with GITHUB_TOKEN (App token step ${outcome}) points at the repository setting`, () => {
		const message = runFailureNotice(outcome);
		assert.match(
			message,
			/sweep and the push to flow-sync\/pending already happened/,
		);
		assert.match(message, /only the pull request was not created/);
		assert.ok(message.includes(SETTING_PATH), message);
		assert.ok(message.includes(SETTING_NAME), message);
		assert.match(message, /organization/);
		assert.match(message, /GITHUB_TOKEN/);
		assert.doesNotMatch(message, /installation/);
	});
}

test("the notice for a PR opened with the App token points at the App, not at the repository setting", () => {
	const message = runFailureNotice("success");
	assert.match(
		message,
		/sweep and the push to flow-sync\/pending already happened/,
	);
	assert.match(message, /only the pull request was not created/);
	assert.match(message, /installation/);
	assert.match(message, /Contents/);
	assert.match(message, /Pull requests/);
	assert.ok(!message.includes(SETTING_PATH), message);
	assert.ok(!message.includes(SETTING_NAME), message);
});

for (const outcome of ["skipped", "success"]) {
	test(`the notice carries a compare URL that opens the PR by hand (App token step ${outcome})`, () => {
		for (const defaultBranch of ["main", "trunk", "release/2026"]) {
			const message = runFailureNotice(outcome, defaultBranch);
			assert.ok(
				message.includes(
					`https://github.example/octo/repo/compare/${defaultBranch}...${openPrStep.with.branch}`,
				),
				message,
			);
		}
	});
}
