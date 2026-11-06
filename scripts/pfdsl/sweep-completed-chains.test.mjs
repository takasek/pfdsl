// Integration coverage for sweep-completed-chains.mjs itself (issue #1125).
// Retention and verification are covered by the CLI's prune tests. These
// adapter scenarios exercise real CLI resolution, forwarding and failures.
// They also check that preview and refusal leave no temporary files. They need
// the real `pfdsl` CLI, so this spawns the script as a subprocess against
// the repo's own build (see resolveCli() in the script under test).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "sweep-completed-chains.mjs");
const cliPath = resolve(__dirname, "../../packages/cli/dist/cli.js");

let sandbox;
let adapter;
let dir;
let sub;

beforeEach(() => {
	sandbox = mkdtempSync(join(tmpdir(), "sweep-completed-chains-test-"));
	dir = join(sandbox, "adopter");
	const scripts = join(dir, "scripts/pfdsl");
	mkdirSync(join(scripts, "lib"), { recursive: true });
	adapter = join(scripts, "sweep-completed-chains.mjs");
	copyFileSync(scriptPath, adapter);
	copyFileSync(
		join(__dirname, "lib/github-issues-config.mjs"),
		join(scripts, "lib/github-issues-config.mjs"),
	);
	mkdirSync(join(dir, ".pfdsl"));
	writeFileSync(
		join(dir, ".pfdsl/config.json"),
		'{"githubIssues":{"enabled":true}}',
	);
});

afterEach(() => {
	rmSync(sandbox, { recursive: true, force: true });
});

function runSweep(args, envOverrides = {}, cwd = dir) {
	return spawnSync(process.execPath, [adapter, ...args], {
		cwd,
		encoding: "utf-8",
		env: { ...process.env, PFDSL_CLI: cliPath, ...envOverrides },
	});
}

/** Files in `dirPath` other than the ones the fixture itself put there. */
function extraFiles(dirPath, expected) {
	return readdirSync(dirPath).filter((name) => !expected.includes(name));
}

describe("sweep-completed-chains: relative dependency validation (#1125)", () => {
	// sub/roadmap.pfdsl extends sub/preset.pfdsl by a relative path. `check`
	// resolves that path from the file being checked's own directory, so
	// verifying a delete candidate anywhere other than sub/ makes `check`
	// report V026 (extends file not found) even though the real file, in its
	// real location, is fine.
	const preset = "---\n---\n";
	const roadmap = `---
extends: ./preset.pfdsl
type: roadmap
artifact:
  legacy_in: { label: Legacy In, status: done }
  legacy_out: { label: Legacy Out, status: done }
  feature: { label: Feature, status: todo }
process:
  build_legacy: { label: Build Legacy }
  build_feature: { label: Build Feature }
---

legacy_in >> build_legacy -> legacy_out

legacy_in >> build_feature -> feature
`;

	let roadmapFile;

	beforeEach(() => {
		sub = join(dir, "sub");
		mkdirSync(sub);
		roadmapFile = join(sub, "roadmap.pfdsl");
		writeFileSync(roadmapFile, roadmap);
		writeFileSync(join(sub, "preset.pfdsl"), preset);
	});

	it("sweeps a completed chain when the file has a relative extends, and leaves the directory clean", () => {
		const result = runSweep([roadmapFile, "--write"]);
		assert.equal(result.status, 0, result.stdout + result.stderr);

		const after = readFileSync(roadmapFile, "utf-8");
		assert.equal(after.includes("build_legacy"), false);
		assert.equal(after.includes("legacy_out"), false);
		assert.equal(after.includes("extends: ./preset.pfdsl"), true);

		assert.deepEqual(
			extraFiles(sub, ["roadmap.pfdsl", "preset.pfdsl"]),
			[],
			"no scratch file should remain next to the swept file",
		);
	});

	it("leaves the file untouched and the directory clean on a dry run", () => {
		const before = readFileSync(roadmapFile, "utf-8");
		const result = runSweep([roadmapFile]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(readFileSync(roadmapFile, "utf-8"), before);

		assert.deepEqual(
			extraFiles(sub, ["roadmap.pfdsl", "preset.pfdsl"]),
			[],
			"no scratch file should remain next to the swept file after a dry run",
		);
	});
});

describe("sweep-completed-chains: canonical-fmt gate (#1125)", () => {
	// A PR opened with GITHUB_TOKEN has its pull_request runs held until someone approves them, so the repo's own `make check-fmt` cannot be counted on to run against this bot's output.
	// Nothing outside the script itself is guaranteed to verify it.
	// This fixture starts from a structurally valid but not canonically formatted roadmap (`check` only warns, `fmt --check` fails).
	// The quoting `"123a"`/`"on"` carry in the body is unnecessary and `fmt` would strip it, but nothing the delete touches revisits that quoting.
	// So it survives into the delete output untouched, still non-canonical, still unnoticed by `check`, `graph orphans`, or the ready/blocked comparison alone.
	const nonCanonical = `---
type: roadmap
artifact:
  "123a": { label: A, status: done }
  "on": { label: On, status: done }
  d: { label: D, status: todo }
process:
  p1: { label: P1 }
  p2: { label: P2 }
---

"123a" >> p1 -> "on"

"123a" >> p2 -> d
`;

	let file;

	beforeEach(() => {
		file = join(dir, "roadmap.pfdsl");
		writeFileSync(file, nonCanonical);
	});

	it("refuses noncanonical input and exits 1", () => {
		const result = runSweep([file, "--write"]);
		assert.equal(result.status, 1);
		assert.match(JSON.parse(result.stdout).error, /not canonically formatted/);

		assert.equal(readFileSync(file, "utf-8"), nonCanonical);
		assert.deepEqual(
			extraFiles(dir, ["roadmap.pfdsl", "scripts", ".pfdsl"]),
			[],
			"no scratch file should remain after a failed fmt check",
		);
	});
});

describe("deployed sweep adapter adoption", () => {
	for (const [config, expectedStatus] of [
		['{"sweepCompletedChains":{"enabled":true}}', 0],
		['{"githubIssues":{"enabled":false}}', 0],
		['{"githubIssues":{}}', 1],
		[
			'{"githubIssues":{"enabled":true},"sweepCompletedChains":{"enabled":false}}',
			23,
		],
	]) {
		it(`checks the deployed repository config before CLI resolution: ${config}`, () => {
			writeFileSync(join(dir, ".pfdsl/config.json"), config);
			const cli = join(dir, "cli.cjs");
			writeFileSync(cli, "process.exit(23);");
			writeFileSync(join(dir, "roadmap.pfdsl"), "");
			const result = runSweep(["roadmap.pfdsl"], { PFDSL_CLI: cli });
			assert.equal(
				result.status,
				expectedStatus,
				result.stdout + result.stderr,
			);
			if (expectedStatus === 0) assert.match(result.stdout, /not applicable/i);
			if (expectedStatus === 1) assert.match(result.stderr, /config\.json/);
		});
	}
});

describe("deployed sweep checkout boundary", () => {
	for (const kind of [
		"absolute",
		"other cwd",
		"symlink",
		"nested repository",
		"nested worktree",
	]) {
		it(`rejects ${kind} before the CLI can write`, () => {
			const nested = kind.startsWith("nested");
			const foreign = join(nested ? dir : sandbox, "other");
			mkdirSync(foreign);
			if (kind === "nested worktree")
				writeFileSync(
					join(foreign, ".git"),
					"gitdir: /other/worktrees/fixture",
				);
			if (kind === "nested repository") mkdirSync(join(foreign, ".git"));
			const file = join(foreign, "roadmap.pfdsl");
			writeFileSync(file, "original");
			let arg = file;
			if (kind === "symlink") {
				arg = join(dir, "link.pfdsl");
				symlinkSync(file, arg);
			}
			if (kind === "other cwd") arg = "roadmap.pfdsl";
			const cli = join(dir, "cli.cjs");
			writeFileSync(
				cli,
				'require("node:fs").writeFileSync(process.argv[3], "overwritten");',
			);
			const result = runSweep(
				[arg, "--write"],
				{ PFDSL_CLI: cli },
				kind === "other cwd" ? foreign : dir,
			);
			assert.equal(readFileSync(file, "utf8"), "original");
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stderr, /checkout/);
		});
	}
});

describe("sweep-completed-chains: direct CLI forwarding", () => {
	for (const write of [false, true]) {
		it(`forwards the request and CLI exit without a capability probe (write=${write})`, () => {
			const cli = join(dir, "cli.cjs");
			const calls = join(dir, "calls.jsonl");
			writeFileSync(join(dir, "roadmap.pfdsl"), "");
			writeFileSync(
				cli,
				`
const { appendFileSync } = require('node:fs');
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stdout.write('cli report\\n');
process.stderr.write('cli diagnostic\\n');
process.exit(2);
`,
			);
			const result = runSweep(
				["roadmap.pfdsl", ...(write ? ["--write"] : [])],
				{ PFDSL_CLI: cli },
			);
			assert.equal(result.status, 2);
			assert.equal(result.stdout, "cli report\n");
			assert.equal(result.stderr, "cli diagnostic\n");
			assert.deepEqual(
				readFileSync(calls, "utf8")
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line)),
				[
					[
						"prune",
						realpathSync(join(dir, "roadmap.pfdsl")),
						"--json",
						...(write ? ["--write"] : []),
					],
				],
			);
		});
	}
});

describe("sweep-completed-chains: quoted id containing a comma (#1125 review defect 2)", () => {
	// "a,b" is a single artifact id that needs quoting (formatId would render
	// it as `"a,b"`). Both this fixture's done artifacts, and p1, end up as
	// delete targets — joining them with a bare comma before passing them to
	// `delete` would split "a,b" into two ids ("a and b"), which then show up
	// in `notFound` instead of `deleted` and leave the quoted id behind.
	let roadmapFile;

	beforeEach(() => {
		roadmapFile = join(dir, "roadmap.pfdsl");
		writeFileSync(
			roadmapFile,
			`---
type: roadmap
artifact:
  "a,b": { label: A-B, status: done }
  out: { label: Out, status: done }
process:
  p1: { label: P1 }
---

"a,b" >> p1 -> out
`,
		);
	});

	it("dry run reports the quoted id as one sweep target, not split in two", () => {
		const result = runSweep([roadmapFile]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		const listed = JSON.parse(result.stdout).deleted;
		assert.deepEqual(listed, ["a,b", "out", "p1"]);
	});

	it("--write removes the quoted id's declaration cleanly, without a stray 'b\"' fragment", () => {
		const result = runSweep([roadmapFile, "--write"]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		const after = readFileSync(roadmapFile, "utf-8");
		assert.doesNotMatch(after, /b"/);
		assert.doesNotMatch(after, /"a\b/);
	});
});
