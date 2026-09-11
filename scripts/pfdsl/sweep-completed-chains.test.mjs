// Integration coverage for sweep-completed-chains.mjs itself (issue #1125).
// Pure decision logic (which ids to delete, the ready/blocked comparison)
// already has focused unit tests under lib/; what only shows up by running
// the script end to end is where it puts and cleans up its verification
// scratch file, and how it reacts to that verification failing. Both need
// the real `pfdsl` CLI, so this spawns the script as a subprocess against
// the repo's own build (see resolveCli() in the script under test).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "sweep-completed-chains.mjs");
const cliPath = resolve(__dirname, "../../packages/cli/dist/cli.js");

let dir;
let sub;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "sweep-completed-chains-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

function runSweep(args, envOverrides = {}) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		encoding: "utf-8",
		env: { ...process.env, PFDSL_CLI: cliPath, ...envOverrides },
	});
}

/**
 * A stand-in for a pre-delete @pfdsl/cli (the published 0.0.26 and earlier):
 * any other command succeeds, `delete` reports the same "unknown command"
 * shape the real dispatcher uses.
 */
function writeCliWithoutDelete(path) {
	writeFileSync(
		path,
		[
			"#!/usr/bin/env node",
			"const command = process.argv[2];",
			"if (command === 'delete') {",
			"\tprocess.stderr.write('unknown command: delete\\n');",
			"\tprocess.exit(2);",
			"}",
			"process.exit(0);",
			"",
		].join("\n"),
	);
}

/** Files in `dirPath` other than the ones the fixture itself put there. */
function extraFiles(dirPath, expected) {
	return readdirSync(dirPath).filter((name) => !expected.includes(name));
}

describe("sweep-completed-chains: scratch verification location (#1125)", () => {
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
	// GITHUB_TOKEN-authored PRs never trigger the pull_request workflow, so
	// the repo's own `make check-fmt` never runs against this bot's output —
	// nothing outside the script itself verifies it. This fixture starts
	// from a structurally valid but not canonically formatted roadmap
	// (`check` only warns, `fmt --check` fails): the quoting `"123a"`/`"on"`
	// carry in the body is unnecessary and `fmt` would strip it, but nothing
	// the delete touches revisits that quoting, so it survives into the
	// delete output untouched — still non-canonical, still unnoticed by
	// `check`, `graph orphans`, or the ready/blocked comparison alone.
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

	it("refuses to apply a delete candidate that is not canonically formatted, and exits 1", () => {
		const result = runSweep([file, "--write"]);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /not canonically formatted/);

		assert.equal(readFileSync(file, "utf-8"), nonCanonical);
		assert.deepEqual(
			extraFiles(dir, ["roadmap.pfdsl"]),
			[],
			"no scratch file should remain after a failed fmt check",
		);
	});
});

describe("sweep-completed-chains: delete-capability gate (#1125 review defect 1)", () => {
	// A workflow that only `npm install --no-save @pfdsl/cli`s a published
	// release can resolve a CLI build that predates the `delete` subcommand
	// (the published 0.0.26 and earlier). Nothing before this gate notices —
	// resolveCli() only checks the path exists, not what the binary at that
	// path can do — so the first sign was `delete` itself failing with
	// "unknown command" mid-run, after sweep targets were already found.
	let roadmapFile;
	let oldCli;

	beforeEach(() => {
		roadmapFile = join(dir, "roadmap.pfdsl");
		writeFileSync(roadmapFile, "---\ntype: roadmap\n---\n");
		oldCli = join(dir, "old-cli-no-delete.js");
		writeCliWithoutDelete(oldCli);
	});

	it("fails at startup, before searching for sweep targets, when the resolved CLI has no 'delete'", () => {
		const result = runSweep([roadmapFile], { PFDSL_CLI: oldCli });
		assert.equal(result.status, 1);
		assert.match(result.stderr, /delete/);
		assert.doesNotMatch(result.stdout, /sweep target/);
	});

	it("names how to get a capable CLI without guessing a specific version number", () => {
		const result = runSweep([roadmapFile], { PFDSL_CLI: oldCli });
		// The floor is described relative to a verified fact (the published
		// 0.0.26 lacks 'delete'), not a fabricated "requires >= X.Y.Z" — this
		// repo's own packages/cli/package.json has not been bumped past 0.0.26
		// since 'delete' was added, so that number cannot be asserted as the
		// floor without being wrong the moment it is read.
		assert.match(result.stderr, /0\.0\.26/);
		assert.match(result.stderr, /pnpm -r build|PFDSL_CLI/);
	});

	it("still works normally when the resolved CLI does have 'delete'", () => {
		const result = runSweep([roadmapFile]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
	});
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
		const listLine = result.stdout.trim().split("\n").at(-1);
		const listed = listLine.split(", ").sort();
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
