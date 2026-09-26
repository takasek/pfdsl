import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	fixture = mkdtempSync(join(tmpdir(), "check-drift-gates-"));
	cpSync(join(root, "scripts"), join(fixture, "scripts"), { recursive: true });
	git(["init", "--quiet", "--initial-branch=main"]);
	git(["config", "user.email", "test@example.com"]);
	git(["config", "user.name", "Test User"]);
	mkdirSync(join(fixture, "hooks"), { recursive: true });
	writeFileSync(join(fixture, "hooks/example.mjs"), "export {};\n");
	git(["add", "hooks/example.mjs"]);
	git(["commit", "--quiet", "-m", "test: add a gen-plugin source"]);
});

afterEach(() => rmSync(fixture, { recursive: true, force: true }));

function runGates() {
	return spawnSync(
		process.execPath,
		[join(fixture, "scripts/check-drift-gates.mjs")],
		{ cwd: fixture, encoding: "utf8" },
	);
}

// The fixture has no generator inputs, so a gen-plugin gate that runs fails
// or reports its skipped SKILL.md half; one that is not triggered is silent.
describe("check-drift-gates staged triggers", () => {
	it("runs the gen-plugin gates when a commit only deletes an input", () => {
		git(["rm", "--quiet", "hooks/example.mjs"]);
		assert.match(runGates().stdout, /SKILL\.md|Claude and Codex outputs/);
	});

	it("runs the gen-plugin gates when a commit moves an input out of the trigger", () => {
		mkdirSync(join(fixture, "notes"), { recursive: true });
		git(["mv", "hooks/example.mjs", "notes/example.mjs"]);
		assert.match(runGates().stdout, /SKILL\.md|Claude and Codex outputs/);
	});

	it("stays silent for a staged change no gate covers", () => {
		writeFileSync(join(fixture, "notes.txt"), "x\n");
		git(["add", "notes.txt"]);
		const result = runGates();
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(result.stdout, "");
	});
});
