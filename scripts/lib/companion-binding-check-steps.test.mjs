import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCompanionBindingsCheck } from "./companion-binding-check-steps.mjs";

const PFD_RETRO_PATH = ".pfdsl/bindings/pfd-retro.md";
const PFD_OPS_PATH = ".pfdsl/bindings/pfd-ops.md";

function baseDeps(overrides = {}) {
	return {
		listFiles: () => [],
		readFile: () => "",
		exists: () => false,
		...overrides,
	};
}

describe("runCompanionBindingsCheck", () => {
	it("keeps historical references without exempting current bindings or lookalike paths", () => {
		for (const [file, expected] of [
			[".pfdsl/bindings/pfd-retro-patterns/case.md", 0],
			[".pfdsl/bindings/pfd-retro-patterns/nested/case.md", 0],
			[".pfdsl/bindings/pfd-retro.md", 1],
			[".pfdsl/bindings/pfd-retro-patterns-current/case.md", 1],
		]) {
			const result = runCompanionBindingsCheck(
				baseDeps({
					listFiles: () => [file],
					readFile: () => "see `scripts/removed-mechanism.mjs`",
				}),
			);
			assert.equal(result.exitCode, expected, file);
		}
	});

	it("passes with no companion files and no pfd-retro.md", () => {
		const result = runCompanionBindingsCheck(baseDeps());
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.stdoutLines, [
			"check-companion-bindings: all passed",
		]);
		assert.deepEqual(result.stderrLines, []);
	});

	it("flags a dead path reference in a companion file (dead-path check alone)", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [".pfdsl/foo.md"],
				readFile: () => "see `docs/missing.md` for details",
				exists: (path) =>
					path !== "docs/missing.md" &&
					path !== PFD_RETRO_PATH &&
					path !== PFD_OPS_PATH,
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/dead path reference `docs\/missing\.md`/,
		);
		assert.match(result.stderrLines.at(-1), /1 error\(s\)/);
	});

	it("does not flag a live path reference", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [".pfdsl/foo.md"],
				readFile: () => "see `docs/present.md` for details",
				exists: (path) => path !== PFD_RETRO_PATH && path !== PFD_OPS_PATH,
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
		assert.ok(
			!readCalls.includes(PFD_RETRO_PATH),
			"pfd-retro.md must not be read when it does not exist",
		);
	});

	// Isolates the second check: no companion-file dead paths at all, only a
	// missing required heading in pfd-retro.md. If someone accidentally
	// stopped counting this check's errors, this is the test that would catch it.
	it("flags a missing required heading in pfd-retro.md (heading check alone)", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				exists: (path) => path === PFD_RETRO_PATH,
				readFile: (file) =>
					file === PFD_RETRO_PATH ? "# unrelated heading\n" : "",
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/missing required heading "pfd-retro バインディング"/,
		);
	});

	it("passes when pfd-retro.md exists and has the required heading", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				exists: (path) => path === PFD_RETRO_PATH,
				readFile: (file) =>
					file === PFD_RETRO_PATH ? "# pfd-retro バインディング\n" : "",
			}),
		);
		assert.equal(result.exitCode, 0);
	});

	// The work cycle's repo-level steps live in pfd-ops' binding, so a binding
	// without that section silently drops them from every cycle.
	it("skips the pfd-ops.md heading check entirely when the file does not exist", () => {
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
		assert.ok(
			!readCalls.includes(PFD_OPS_PATH),
			"pfd-ops.md must not be read when it does not exist",
		);
	});

	it("flags a missing required heading in pfd-ops.md (heading check alone)", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				exists: (path) => path === PFD_OPS_PATH,
				readFile: (file) =>
					file === PFD_OPS_PATH ? "# pfd-ops バインディング\n" : "",
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/missing required heading "ワークサイクルの追加手順"/,
		);
	});

	it("passes when pfd-ops.md exists and has both required headings", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				exists: (path) => path === PFD_OPS_PATH,
				readFile: (file) =>
					file === PFD_OPS_PATH
						? "# pfd-ops バインディング\n\n## ワークサイクルの追加手順\n"
						: "",
			}),
		);
		assert.equal(result.exitCode, 0);
	});

	it("accumulates errors from both checks into one errorCount", () => {
		const result = runCompanionBindingsCheck({
			listFiles: () => [".pfdsl/foo.md"],
			readFile: (file) =>
				file === PFD_RETRO_PATH
					? "# unrelated heading\n"
					: "see `docs/missing.md`",
			exists: (path) => path === PFD_RETRO_PATH,
		});
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines.at(-1), /2 error\(s\)/);
	});
});

// The pfd-retro case store is exempt from the dead-path check because its
// repo-relative references are frozen evidence, but a relative link into
// another live document is navigation, not evidence — so it is checked even
// there (#1231 follow-up).
describe("runCompanionBindingsCheck relative markdown links", () => {
	const CASE = ".pfdsl/bindings/pfd-retro-patterns/case.md";

	it("flags a dead relative link inside the exempt case store", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [CASE],
				readFile: () => "現行手順は [binding](../pfd-retro.md) を参照。",
				exists: () => false,
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/dead relative link `\.\.\/pfd-retro\.md` \(resolved: \.pfdsl\/bindings\/pfd-retro\.md\)/,
		);
	});

	it("resolves a sibling link against the linking file's own directory", () => {
		const resolved = ".pfdsl/bindings/pfd-retro-patterns/other.md";
		const seen = [];
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [CASE],
				readFile: () => "see [other](other.md)",
				exists: (path) => {
					seen.push(path);
					return path === resolved;
				},
			}),
		);
		assert.equal(result.exitCode, 0);
		assert.ok(seen.includes(resolved), seen.join(", "));
	});

	it("keeps the dead-path exemption for the same file (frozen evidence)", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [CASE],
				readFile: (file) =>
					file === PFD_RETRO_PATH
						? "# pfd-retro バインディング\n"
						: "当時は `scripts/removed-mechanism.mjs` だった。現行は [binding](../pfd-retro.md)。",
				exists: (path) => path === PFD_RETRO_PATH,
			}),
		);
		assert.equal(result.exitCode, 0);
	});

	it("checks relative links in ordinary companions too", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [".pfdsl/workflow.md"],
				readFile: () => "see [gone](./gone.md)",
				exists: () => false,
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /resolved: \.pfdsl\/gone\.md/);
	});
});

// The two link checks split by where a target resolves, not by how it was
// spelled. A repo path written in dot-relative form is still a repo path, and
// in a case file it is frozen evidence the dead-path check deliberately
// exempts — so the relative-link check has to hand it back rather than demand
// it stay live (#1231 follow-up review).
describe("runCompanionBindingsCheck link-check boundary", () => {
	const CASE = ".pfdsl/bindings/pfd-retro-patterns/case.md";

	it("leaves a target resolving outside .pfdsl/ to the dead-path check", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [CASE],
				readFile: () =>
					"当時は [仕様](../../../docs/spec/gone.md) を見ていた。",
				exists: () => false,
			}),
		);
		assert.equal(result.exitCode, 0, result.stderrLines.join("\n"));
	});

	it("still checks it in an ordinary companion via the dead-path check", () => {
		const result = runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [".pfdsl/workflow.md"],
				readFile: () => "see `docs/spec/gone.md`",
				exists: () => false,
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /dead path reference/);
	});

	it("reads each file once across both link checks", () => {
		const reads = [];
		runCompanionBindingsCheck(
			baseDeps({
				listFiles: () => [".pfdsl/workflow.md"],
				readFile: (file) => {
					reads.push(file);
					return "";
				},
				exists: () => false,
			}),
		);
		assert.deepEqual(reads, [".pfdsl/workflow.md"]);
	});
});
