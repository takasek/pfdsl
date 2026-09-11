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

function runSweep(args) {
	return spawnSync(process.execPath, [scriptPath, ...args], {
		encoding: "utf-8",
		env: { ...process.env, PFDSL_CLI: cliPath },
	});
}

/** Files in `sub` other than the ones the fixture itself put there. */
function extraFiles(expected) {
	return readdirSync(sub).filter((name) => !expected.includes(name));
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
			extraFiles(["roadmap.pfdsl", "preset.pfdsl"]),
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
			extraFiles(["roadmap.pfdsl", "preset.pfdsl"]),
			[],
			"no scratch file should remain next to the swept file after a dry run",
		);
	});
});
