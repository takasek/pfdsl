import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runCompanionBindingsCheck } from "./companion-binding-check-steps.mjs";

const PFD_RETRO_PATH = ".pfdsl/bindings/pfd-retro.md";

function baseDeps(overrides = {}) {
	return {
		listFiles: () => [],
		readFile: () => "",
		exists: () => false,
		...overrides,
	};
}

describe("runCompanionBindingsCheck", () => {
	it("passes with no companion files and no pfd-retro.md", () => {
		const result = runCompanionBindingsCheck(baseDeps());
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.stdoutLines, ["check-companion-bindings: all passed"]);
		assert.deepEqual(result.stderrLines, []);
	});

	it("flags a dead path reference in a companion file (dead-path check alone)", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [".pfdsl/foo.md"],
				readFile: () => "see `docs/missing.md` for details",
				exists: (path) => path !== "docs/missing.md" && path !== PFD_RETRO_PATH,
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /dead path reference `docs\/missing\.md`/);
		assert.match(result.stderrLines.at(-1), /1 error\(s\)/);
	});

	it("does not flag a live path reference", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [".pfdsl/foo.md"],
				readFile: () => "see `docs/present.md` for details",
				exists: (path) => path !== PFD_RETRO_PATH,
			}),
		);
		assert.equal(result.exitCode, 0);
	});

	it("skips the pfd-retro.md heading check entirely when the file does not exist", () => {
		const readCalls = [];
		const result = runCompanionBindingsCheck(
			baseDeps({
				exists: () => false,
				readFile: (file) => {
					readCalls.push(file);
					return "";
				},
			}),
		);
		assert.equal(result.exitCode, 0);
		assert.ok(!readCalls.includes(PFD_RETRO_PATH), "pfd-retro.md must not be read when it does not exist");
	});

	// Isolates the second check: no companion-file dead paths at all, only a
	// missing required heading in pfd-retro.md. If someone accidentally
	// stopped counting this check's errors, this is the test that would catch it.
	it("flags a missing required heading in pfd-retro.md (heading check alone)", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				exists: (path) => path === PFD_RETRO_PATH,
				readFile: (file) => (file === PFD_RETRO_PATH ? "# unrelated heading\n" : ""),
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /missing required heading "pfd-retro バインディング"/);
	});

	it("passes when pfd-retro.md exists and has the required heading", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				exists: (path) => path === PFD_RETRO_PATH,
				readFile: (file) => (file === PFD_RETRO_PATH ? "# pfd-retro バインディング\n" : ""),
			}),
		);
		assert.equal(result.exitCode, 0);
	});

	it("accumulates errors from both checks into one errorCount", () => {
		const result = runCompanionBindingsCheck({
			listFiles: () => [".pfdsl/foo.md"],
			readFile: (file) =>
				file === PFD_RETRO_PATH ? "# unrelated heading\n" : "see `docs/missing.md`",
			exists: (path) => path === PFD_RETRO_PATH,
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines.at(-1), /2 error\(s\)/);
	});
});
