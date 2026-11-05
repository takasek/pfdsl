import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fixture;

function git(args) {
	const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
}

beforeEach(() => {
	fixture = mkdtempSync(join(tmpdir(), "gate-check-record-recovery-"));
	cpSync(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
	mkdirSync(join(fixture, "node_modules"));
	symlinkSync(
		realpathSync(join(root, "node_modules/yaml")),
		join(fixture, "node_modules/yaml"),
		"dir",
	);
	// Isolate unrelated project-wide checks; the gate entrypoint, its steps,
	// commit lint and all git history queries run unchanged.
	writeFileSync(
		join(fixture, "scripts/pfdsl/audit-issues-flow.mjs"),
		"process.exit(0);\n",
	);
	writeFileSync(join(fixture, "Makefile"), "check-docs:\n\t@true\n");
	git(["init", "--bare", "remote.git"]);
	git(["init", "--initial-branch=main"]);
	git(["config", "user.email", "test@example.com"]);
	git(["config", "user.name", "Test User"]);
	mkdirSync(join(fixture, "packages/core/src/__fixtures__"), {
		recursive: true,
	});
	writeFileSync(
		join(fixture, "packages/core/src/__fixtures__/pipeline-scale.pfdsl"),
		"a >> p -> b\n",
	);
	git(["add", "packages/core/src/__fixtures__/pipeline-scale.pfdsl"]);
	git(["commit", "--allow-empty", "-m", "test: establish main"]);
	git(["remote", "add", "origin", join(fixture, "remote.git")]);
	git(["push", "origin", "HEAD:main"]);
	mkdirSync(join(fixture, "packages/example"), { recursive: true });
	writeFileSync(
		join(fixture, "packages/example/index.js"),
		"export const value = 1;\n",
	);
	git(["add", "packages/example/index.js"]);
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

it("uses the PR merge-base for size and the committed head model after base advances", () => {
	mkdirSync(join(fixture, ".pfdsl"));
	writeFileSync(join(fixture, ".pfdsl/workflow.md"), "base\n");
	git(["add", ".pfdsl/workflow.md"]);
	git(["commit", "-m", "test: establish knowledge baseline"]);
	git(["push", "origin", "HEAD:main"]);
	git(["switch", "-c", "review"]);
	writeFileSync(
		join(fixture, "packages/example/index.js"),
		"export const value = 2;\n",
	);
	git(["add", "packages/example/index.js"]);
	writeFileSync(join(fixture, ".pfdsl/workflow.md"), "branch growth\n");
	const model =
		"---\nartifact:\n  a:\n    location: ../packages/example/index.js\n---\na >> p -> b\n";
	writeFileSync(join(fixture, ".pfdsl/workflow.pfdsl"), model);
	git(["add", ".pfdsl"]);
	git(["commit", "-m", "test: change reviewed knowledge"]);
	const reviewed = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: fixture,
		encoding: "utf8",
	}).stdout.trim();
	git(["switch", "main"]);
	writeFileSync(
		join(fixture, ".pfdsl/workflow.md"),
		"unrelated base growth that is much larger\n",
	);
	git(["add", ".pfdsl/workflow.md"]);
	git(["commit", "-m", "test: advance base independently"]);
	git(["push", "origin", "HEAD:main"]);
	git(["switch", "review"]);
	for (const pkg of ["core", "cli"]) {
		mkdirSync(join(fixture, `packages/${pkg}`), { recursive: true });
		symlinkSync(
			join(root, `packages/${pkg}/dist`),
			join(fixture, `packages/${pkg}/dist`),
			"dir",
		);
	}
	writeFileSync(
		join(fixture, ".pfdsl/workflow.pfdsl"),
		model.replace("packages/example/index.js", "uncommitted.js"),
	);
	const result = runGate();
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, new RegExp(`Report revision: head ${reviewed}`));
	assert.match(result.stdout, /workflow\.md: \+9 bytes/);
	assert.doesNotMatch(result.stderr, /fatal:/);
	assert.match(
		result.stdout,
		/packages\/example\/index\.js ← \.pfdsl\/workflow\.pfdsl:a/,
	);
	assert.doesNotMatch(result.stdout, /uncommitted\.js/);
	writeFileSync(join(fixture, ".pfdsl/workflow.md"), "next branch growth\n");
	git(["add", ".pfdsl/workflow.md"]);
	git(["commit", "-m", "test: add reviewed commit"]);
	const next = runGate();
	assert.equal(next.status, 0, next.stdout + next.stderr);
	assert.match(next.stdout, /workflow\.md: \+14 bytes/);
	assert.ok(!next.stdout.includes(`Report revision: head ${reviewed}`));
});

it("reports original non-ASCII knowledge paths rather than Git display quoting", () => {
	const path = ".pfdsl/bindings/日本語.md";
	mkdirSync(dirname(join(fixture, path)), { recursive: true });
	writeFileSync(join(fixture, path), "text\n");
	git(["config", "core.quotePath", "true"]);
	git(["add", path]);
	git(["commit", "-m", "docs: add non-ASCII knowledge"]);
	const result = runGate();
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.ok(result.stdout.includes(`${path}: +5 bytes`), result.stdout);
});

function runGate(args = []) {
	return spawnSync(
		process.execPath,
		[join(fixture, "scripts/gate-check.mjs"), "--no-artifact", ...args],
		{
			cwd: fixture,
			encoding: "utf8",
		},
	);
}

it("uses the selected Wiki snapshot and refuses to infer completed work from repository history", () => {
	for (const pkg of ["core", "cli"]) {
		mkdirSync(join(fixture, `packages/${pkg}`), { recursive: true });
		symlinkSync(
			join(root, `packages/${pkg}/dist`),
			join(fixture, `packages/${pkg}/dist`),
			"dir",
		);
	}
	const wiki = join(fixture, "wiki");
	mkdirSync(wiki);
	git(["-C", wiki, "init", "--initial-branch=main"]);
	git(["-C", wiki, "config", "user.email", "test@example.com"]);
	git(["-C", wiki, "config", "user.name", "Test"]);
	const text =
		"---\ntype: roadmap\nartifact:\n  input: {status: done}\n  result: {status: wip, criteria: Reviewed.}\n---\ninput >> work -> result\n";
	writeFileSync(join(wiki, "roadmap.pfdsl"), text);
	writeFileSync(join(wiki, "roadmap.md"), "Companion\n");
	git(["-C", wiki, "add", "."]);
	git(["-C", wiki, "commit", "-m", "test: source snapshot"]);
	const wikiRevision = spawnSync("git", ["-C", wiki, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).stdout.trim();
	mkdirSync(join(fixture, ".pfdsl"));
	writeFileSync(join(fixture, ".pfdsl/roadmap.pfdsl"), "invalid old roadmap\n");
	git(["add", ".pfdsl"]);
	git(["commit", "-m", "test: implementation work"]);
	const basisRevision = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: fixture,
		encoding: "utf8",
	}).stdout.trim();
	const config = join(fixture, "source.json");
	writeFileSync(
		config,
		JSON.stringify({
			roadmapSource: {
				adapter: "local-git",
				source: "wiki",
				revision: wikiRevision,
				documentId: "roadmap.pfdsl",
				companionId: "roadmap.md",
				logicalPath: ".pfdsl/roadmap.pfdsl",
				basis: { source: "body", revision: basisRevision },
			},
			localSources: { wiki, body: fixture },
		}),
	);
	writeFileSync(
		join(fixture, "scripts/pfdsl/audit-issues-flow.mjs"),
		`import {readFileSync} from 'node:fs';\nimport assert from 'node:assert/strict';\nconst index = process.argv.indexOf('--roadmap');\nassert.ok(index > 0);\nassert.equal(readFileSync(process.argv[index + 1], 'utf8'), ${JSON.stringify(text)});\n`,
	);
	const invoke = (extra) =>
		spawnSync(
			process.execPath,
			[
				join(fixture, "scripts/gate-check.mjs"),
				"--source-config",
				config,
				"--artifact",
				"result",
				...extra,
			],
			{ cwd: fixture, encoding: "utf8" },
		);
	const progress = invoke(["--in-progress"]);
	assert.equal(progress.status, 0, progress.stdout + progress.stderr);
	assert.match(progress.stdout, new RegExp(wikiRevision));
	assert.match(progress.stdout, /PASS external roadmap check/);
	assert.match(progress.stdout, /SKIP wip transition/);
	assert.doesNotMatch(progress.stdout, /Ready-set diff \(origin/);
	assert.doesNotMatch(progress.stdout, /invalid old roadmap/);
	const complete = invoke([]);
	assert.equal(complete.status, 1, complete.stdout + complete.stderr);
	assert.match(complete.stdout, /completion evidence/);
	assert.match(complete.stdout, /external roadmap start-time history/);
});

function externalClosureConfig({ entry, dependencies = {} }) {
	for (const pkg of ["core", "cli"]) {
		mkdirSync(join(fixture, `packages/${pkg}`), { recursive: true });
		symlinkSync(
			join(root, `packages/${pkg}/dist`),
			join(fixture, `packages/${pkg}/dist`),
			"dir",
		);
	}
	mkdirSync(join(fixture, ".pfdsl"));
	writeFileSync(join(fixture, "evidence.txt"), "Committed evidence\n");
	for (const [name, content] of Object.entries(dependencies)) {
		writeFileSync(join(fixture, ".pfdsl", name), content);
	}
	git(["add", ".pfdsl", "evidence.txt"]);
	git(["commit", "-m", "test: model basis"]);
	const basisRevision = spawnSync("git", ["rev-parse", "HEAD"], {
		cwd: fixture,
		encoding: "utf8",
	}).stdout.trim();
	// This working-tree file must not repair a missing file in the selected commit.
	writeFileSync(join(fixture, "missing.txt"), "Uncommitted decoy\n");
	const wiki = join(fixture, "wiki");
	mkdirSync(wiki);
	git(["-C", wiki, "init", "--initial-branch=main"]);
	git(["-C", wiki, "config", "user.email", "test@example.com"]);
	git(["-C", wiki, "config", "user.name", "Test"]);
	writeFileSync(join(wiki, "roadmap.pfdsl"), entry);
	writeFileSync(join(wiki, "roadmap.md"), "Companion\n");
	git(["-C", wiki, "add", "."]);
	git(["-C", wiki, "commit", "-m", "test: external model"]);
	const wikiRevision = spawnSync("git", ["-C", wiki, "rev-parse", "HEAD"], {
		encoding: "utf8",
	}).stdout.trim();
	const config = join(fixture, "source.json");
	writeFileSync(
		config,
		JSON.stringify({
			roadmapSource: {
				adapter: "local-git",
				source: "wiki",
				revision: wikiRevision,
				documentId: "roadmap.pfdsl",
				companionId: "roadmap.md",
				logicalPath: ".pfdsl/roadmap.pfdsl",
				basis: { source: "body", revision: basisRevision },
			},
			localSources: { wiki, body: fixture },
		}),
	);
	return config;
}

const externalModel = (metadata = "", location = "evidence.txt") =>
	`---\ntype: roadmap\nbasePath: ..\nbaseRef: {source: body, revision: main}\n${metadata}artifact:\n  input: {status: done, location: ${location}}\n  result: {status: wip, criteria: Reviewed.}\n---\ninput >> work -> result\n`;

it("validates an external raw YAML preset through the entry closure without treating it as a diagram", () => {
	const config = externalClosureConfig({
		entry: externalModel("extends: theme.yaml\n"),
		dependencies: {
			"theme.yaml": "statusStyles:\n  done: {fillcolor: '#123456'}\n",
		},
	});
	const result = runGate(["--source-config", config]);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(
		result.stdout,
		/PASS external roadmap check \(\.pfdsl\/roadmap.pfdsl\)/,
	);
	assert.doesNotMatch(
		result.stdout,
		/external roadmap (?:check|links) \(\.pfdsl\/theme.yaml\)/,
	);
	assert.doesNotMatch(result.stdout + result.stderr, /L002|P005/);
});

it("fails external entry links when a location is absent from the fixed artifact target", () => {
	const config = externalClosureConfig({
		entry: externalModel("", "missing.txt"),
	});
	const result = runGate(["--source-config", config]);
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(
		result.stdout,
		/PASS external roadmap check \(\.pfdsl\/roadmap.pfdsl\)/,
	);
	assert.match(
		result.stdout,
		/FAIL external roadmap links \(\.pfdsl\/roadmap.pfdsl\)/,
	);
	assert.match(result.stdout, /missing.txt/);
});

it("checks every external child location even when the entry links succeed", () => {
	const config = externalClosureConfig({
		entry: externalModel("process: {work: {subflow: child.txt}}\n"),
		dependencies: {
			"child.txt":
				"---\nbasePath: ..\nbaseRef: {source: body, revision: main}\nartifact:\n  input: {location: missing.txt}\n---\ninput >> child_work -> result\n",
		},
	});
	const result = runGate(["--source-config", config]);
	assert.match(
		result.stdout,
		/PASS external roadmap check \(\.pfdsl\/roadmap.pfdsl\)/,
		result.stderr,
	);
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(
		result.stdout,
		/PASS external roadmap links \(\.pfdsl\/roadmap.pfdsl\)/,
	);
	assert.match(
		result.stdout,
		/FAIL external roadmap links \(\.pfdsl\/child.txt\)/,
	);
	assert.match(result.stdout, /missing.txt/);
});

it("retains replayable reference results for the entry and child without temporary paths", () => {
	const entry = externalModel("process: {work: {subflow: child.txt}}\n")
		.replace("revision: main", "revision: target-one")
		.replace(
			"criteria: Reviewed.",
			"criteria: Reviewed., location: evidence.txt, ref: {source: body, revision: target-two}",
		);
	const config = externalClosureConfig({
		entry,
		dependencies: {
			"child.txt":
				"---\nbasePath: ..\nbaseRef: {source: body, revision: target-one}\nartifact:\n  input: {location: evidence.txt}\n---\ninput >> child_work -> result\n",
		},
	});
	const settings = JSON.parse(readFileSync(config, "utf8"));
	const targets = [];
	for (const name of ["target-one", "target-two"]) {
		writeFileSync(join(fixture, "evidence.txt"), `${name} evidence\n`);
		git(["add", "evidence.txt"]);
		git(["commit", "-m", `test: ${name}`]);
		git(["branch", name]);
		targets.push(
			spawnSync("git", ["rev-parse", "HEAD"], {
				cwd: fixture,
				encoding: "utf8",
			}).stdout.trim(),
		);
	}
	const result = runGate(["--source-config", config]);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	const prefix = "External roadmap reference evidence: ";
	const records = result.stdout
		.split("\n")
		.filter((line) => line.startsWith(prefix))
		.map((line) => JSON.parse(line.slice(prefix.length)));
	assert.equal(records.length, 2, result.stdout);
	const entryRecord = records.find(
		(record) => record.logicalPath === ".pfdsl/roadmap.pfdsl",
	);
	assert.equal(
		entryRecord.model.fixedRevision,
		settings.roadmapSource.revision,
	);
	assert.equal(
		entryRecord.basis.fixedRevision,
		settings.roadmapSource.basis.revision,
	);
	assert.deepEqual(
		entryRecord.targets.map(({ fixedRevision }) => fixedRevision).sort(),
		[...targets].sort(),
	);
	for (const [id, revision] of [
		["input", targets[0]],
		["result", targets[1]],
	]) {
		assert.ok(
			entryRecord.results.some(
				(item) =>
					item.id === id &&
					item.fixedRevision === revision &&
					item.location === "evidence.txt" &&
					item.result === "exists",
			),
			JSON.stringify(entryRecord),
		);
	}
	const childRecord = records.find(
		(record) => record.logicalPath === ".pfdsl/child.txt",
	);
	assert.equal(
		childRecord.model.fixedRevision,
		settings.roadmapSource.basis.revision,
	);
	assert.ok(
		childRecord.results.some(
			(item) =>
				item.id === "input" &&
				item.fixedRevision === targets[0] &&
				item.result === "exists",
		),
	);
	assert.doesNotMatch(
		JSON.stringify(records),
		/"root"|"value"|pfdsl-roadmap-source-/,
	);
	assert.doesNotMatch(result.stdout, /pfdsl-roadmap-source-/);
});

it("fails an otherwise successful link command that omits its reference resolution record", () => {
	const config = externalClosureConfig({ entry: externalModel() });
	const dist = join(fixture, "packages/cli/dist");
	rmSync(dist);
	mkdirSync(dist);
	writeFileSync(
		join(dist, "cli.js"),
		`const {spawnSync} = require('node:child_process');\nconst args = process.argv.slice(2);\nconst result = spawnSync(process.execPath, [${JSON.stringify(join(root, "packages/cli/dist/cli.js"))}, ...args], {encoding: 'utf8'});\nlet output = result.stdout;\nif (args[0] === 'meta' && args[1] === 'check-links') { const report = JSON.parse(output); delete report.referenceResolution; output = JSON.stringify(report); }\nprocess.stdout.write(output);\nprocess.stderr.write(result.stderr);\nprocess.exit(result.status);\n`,
	);
	const result = runGate(["--source-config", config]);
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stdout, /FAIL external roadmap links/);
	assert.match(result.stdout, /resolution record/);
});

function assertFinalManualGuidance(result) {
	const expected = [
		"Manual checks:",
		"  MANUAL: Before creating the PR, review `3. 反映 — 終端ゲート` in `.claude/skills/pfd-ops/references/work-cycle.md`.",
		"  MANUAL: After creating the PR, review the `PR 作成後` items under `PR 作成前後の完了確認` in `.pfdsl/bindings/pfd-ops.md` (`PR と統合`).",
		"  MANUAL: no --issue given; no issue review is implied. Pass every target explicitly for terminal review.",
	];
	const lines = result.stdout.trimEnd().split("\n");
	assert.deepEqual(
		lines.filter(
			(line) => line === "Manual checks:" || line.startsWith("  MANUAL:"),
		),
		expected,
	);
	assert.deepEqual(lines.slice(-expected.length), expected);
}

describe("gate-check package typechecks", () => {
	function addPackage(pkg, source) {
		const dir = join(fixture, "packages", pkg);
		mkdirSync(dir, { recursive: true });
		symlinkSync(
			join(fixture, "node_modules"),
			join(dir, "node_modules"),
			"dir",
		);
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				name: pkg === "vscode-extension" ? "pfdsl" : `@pfdsl/${pkg}`,
				scripts: { typecheck: "tsgo --noEmit" },
			}),
		);
		writeFileSync(
			join(dir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { types: [], strict: true },
				include: ["*.ts"],
			}),
		);
		writeFileSync(join(dir, "example.test.ts"), source);
		// Keep fixture-only manifests out of the branch diff; this suite changes test sources.
		git(["add", `packages/${pkg}/example.test.ts`]);
	}
	beforeEach(() => {
		mkdirSync(join(fixture, "node_modules/.bin"));
		// Link the compiler entrypoint itself: pnpm's .bin shim resolves its
		// sibling .pnpm store relative to the fixture, where that store is absent.
		symlinkSync(
			realpathSync(
				join(root, "node_modules/@typescript/native-preview/bin/tsgo"),
			),
			join(fixture, "node_modules/.bin/tsgo"),
			"file",
		);
		writeFileSync(
			join(fixture, "pnpm-workspace.yaml"),
			"packages:\n  - 'packages/*'\n",
		);
	});
	for (const pkg of ["core", "cli", "vscode-extension"]) {
		it(`fails the gate for a real ${pkg} test-file type error`, () => {
			addPackage(
				pkg,
				"function normalize(document: string, options: object) {}\nnormalize('document');\n",
			);
			git(["commit", "-m", "test: add package type error"]);
			const typecheck = spawnSync(
				"pnpm",
				["--filter", `./packages/${pkg}`, "typecheck"],
				{ cwd: fixture, encoding: "utf8" },
			);
			assert.equal(typecheck.status, 1, typecheck.stdout + typecheck.stderr);
			assert.match(typecheck.stdout + typecheck.stderr, /TS2554/);
			const result = runGate();
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stdout, new RegExp(`FAIL ${pkg} typecheck`));
		});
	}
	it("passes changed packages and skips the unchanged extension", () => {
		for (const pkg of ["core", "cli"])
			addPackage(pkg, "export const value: number = 1;\n");
		git(["commit", "-m", "test: add valid packages"]);
		const result = runGate();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /PASS core typecheck/);
		assert.match(result.stdout, /PASS cli typecheck/);
		assert.match(result.stdout, /SKIP vscode-extension typecheck/);
	});
	it("checks a package when its only change deletes a file", () => {
		addPackage("core", "export const value: number = 1;\n");
		writeFileSync(join(fixture, "packages/core/obsolete.ts"), "export {};\n");
		git(["add", "packages/core/obsolete.ts"]);
		git(["commit", "-m", "test: establish package"]);
		git(["push", "origin", "HEAD:main"]);
		git(["rm", "packages/core/obsolete.ts"]);
		git(["commit", "-m", "test: delete obsolete file"]);
		const result = runGate();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /PASS core typecheck/);
	});
});

describe("gate-check record recovery", () => {
	for (const message of [
		"fix: correct value",
		"fix: correct value\n\nReview: tool=subagent",
	]) {
		it(`accepts code changes without requiring review trailers: ${JSON.stringify(message)}`, () => {
			git(["commit", "-m", message]);
			const result = runGate();
			assert.equal(result.status, 0, result.stdout + result.stderr);
			assert.doesNotMatch(result.stdout, /Review record|malformed record/);
			assert.match(result.stdout, /PASS commit subject lint/);
			assertFinalManualGuidance(result);
		});
	}

	it("still rejects an invalid commit subject", () => {
		git(["commit", "-m", "invalid subject"]);
		const result = runGate();
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /FAIL commit subject lint/);
		assertFinalManualGuidance(result);
	});
});

describe("gate-check human review routing", () => {
	function stubIssues(failures = {}) {
		cpSync(
			join(fixture, "scripts/pfdsl/lib/github-ops.mjs"),
			join(fixture, "scripts/pfdsl/lib/github-ops-api.mjs"),
		);
		writeFileSync(
			join(fixture, "scripts/pfdsl/lib/github-ops.mjs"),
			`
import { appendFileSync } from 'node:fs';
import { GitHubUnavailableError } from './github-ops-api.mjs';
export { isGitHubUnavailableError, GITHUB_UNAVAILABLE_EXIT_CODE } from './github-ops-api.mjs';
export function createGitHubOps() {
  return {
    viewIssue: async ({ number, fields }) => {
      appendFileSync('issue-reads.jsonl', JSON.stringify({ number, fields }) + '\\n');
      const failure = ${JSON.stringify(failures)}[number];
      if (failure?.unavailable) throw new GitHubUnavailableError('viewIssue');
      if (failure) throw Object.assign(new Error(failure.message), { code: failure.code });
      return { body: '設計未確定', comments: [] };
    },
    designRecordEditInfo: async () => { throw new Error('unexpected edit history lookup'); }
  };
}
`,
		);
		git(["commit", "-m", "fix: correct value"]);
	}

	it("names every explicit issue in manual guidance without a record verdict", () => {
		stubIssues();
		const result = runGate(["--issue", "1208", "--issue", "1221"]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.doesNotMatch(
			result.stdout,
			/design-selection record|record-posted|record-incomplete/,
		);
		assert.match(result.stdout, /Manual checks:[\s\S]*#1208, #1221/);
		assert.match(result.stdout, /PASS commit subject lint/);
		const reads = readFileSync(join(fixture, "issue-reads.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map(JSON.parse);
		assert.deepEqual(
			reads.map(({ number }) => number),
			[1208, 1221],
		);
		assert.ok(reads.every(({ fields }) => fields.includes("comments")));
	});

	it("does not infer a terminal issue or claim review when none was specified", () => {
		stubIssues();
		const result = runGate();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.doesNotMatch(result.stdout, /design-selection record/);
		assert.match(
			result.stdout,
			/Manual checks:[\s\S]*no --issue.*no issue review is implied/,
		);
	});

	for (const [code, message, status, verdict] of [
		[undefined, "HTTP 404: issue not found", 1, "FAIL"],
		[undefined, "authentication failed", 1, "FAIL"],
		[undefined, "network unavailable", 1, "FAIL"],
		["ENOENT", "unrelated ENOENT", 1, "FAIL"],
		["GITHUB_UNAVAILABLE", "no backend", 0, "SKIP"],
	]) {
		it(`preserves issue lookup handling: ${message}`, () => {
			stubIssues({
				1208: { code, message, unavailable: code === "GITHUB_UNAVAILABLE" },
			});
			const result = runGate(["--issue", "1208", "--issue", "1221"]);
			assert.equal(result.status, status, result.stdout + result.stderr);
			assert.match(
				result.stdout,
				new RegExp(`${verdict} issue read \\(#1208\\)`),
			);
			assert.match(result.stdout, /Manual checks:[\s\S]*#1208, #1221/);
			assert.doesNotMatch(result.stdout, /design-selection record/);
		});
	}
});

describe("gate-check gen-plugin trigger", () => {
	function publishHookSource(path = "hooks/example.mjs") {
		mkdirSync(join(fixture, "hooks"), { recursive: true });
		writeFileSync(join(fixture, path), "export {};\n");
		git(["add", path]);
		git(["commit", "-m", "test: add a gen-plugin source"]);
		git(["push", "origin", "HEAD:main"]);
	}

	const identityRow = (stdout) =>
		stdout.split("\n").find((line) => line.includes("gen-plugin identity"));

	for (const path of ["hooks/日本語.mjs", "hooks/line\nbreak.mjs"]) {
		for (const change of ["delete", "move"]) {
			it(`regenerates after ${change} of a quoted Git path: ${JSON.stringify(path)}`, () => {
				git(["config", "core.quotePath", "true"]);
				publishHookSource(path);
				git(
					change === "delete"
						? ["rm", "--quiet", path]
						: ["mv", path, "packages/example/moved.mjs"],
				);
				git(["commit", "-m", `fix: ${change} the hook source`]);
				const row = identityRow(runGate().stdout);
				assert.ok(row, "expected a gen-plugin identity row");
				assert.match(row, /FAIL/);
			});
		}
	}

	it("regenerates when a branch only deletes a generator input", () => {
		publishHookSource();
		git(["rm", "--quiet", "hooks/example.mjs"]);
		git(["commit", "-m", "fix: drop the hook source"]);
		const row = identityRow(runGate().stdout);
		assert.ok(row, "expected a gen-plugin identity row");
		assert.doesNotMatch(row, /SKIP/);
	});

	it("regenerates when a branch moves a generator input out of the trigger", () => {
		publishHookSource();
		git(["mv", "hooks/example.mjs", "packages/example/moved.mjs"]);
		git(["commit", "-m", "fix: move the hook source"]);
		const row = identityRow(runGate().stdout);
		assert.ok(row, "expected a gen-plugin identity row");
		assert.doesNotMatch(row, /SKIP/);
	});
});
