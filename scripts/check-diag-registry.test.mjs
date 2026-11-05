import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("check-diag-registry orchestration", () => {
	function makeFixture() {
		const root = mkdtempSync(join(tmpdir(), "check-diag-registry-"));
		temporaryRoots.push(root);
		for (const relativePath of [
			"scripts/check-diag-registry.mjs",
			"scripts/lib/diag-registry-check.mjs",
			"scripts/lib/dist-freshness.mjs",
			"scripts/lib/emit-lines.mjs",
			"docs/spec/spec.md",
		]) {
			const destination = join(root, relativePath);
			mkdirSync(dirname(destination), { recursive: true });
			cpSync(join(repositoryRoot, relativePath), destination);
		}
		const sourceFile = join(root, "packages/core/src/index.ts");
		mkdirSync(dirname(sourceFile), { recursive: true });
		writeFileSync(sourceFile, "export {};\n");
		return root;
	}

	function runCheck(root) {
		return spawnSync(
			process.execPath,
			[join(root, "scripts/check-diag-registry.mjs")],
			{ encoding: "utf8" },
		);
	}

	function assertFreshnessFailure(result) {
		assert.equal(result.status, 1);
		assert.match(result.stderr, /core dist is missing or stale/i);
		assert.match(result.stderr, /pnpm -r build/);
		assert.doesNotMatch(result.stderr, /not emitted by core \(stale\)/);
	}

	it("rejects a missing core dist before reporting semantic registry drift", () => {
		assertFreshnessFailure(runCheck(makeFixture()));
	});

	it("rejects a stale core dist before reporting semantic registry drift", () => {
		const root = makeFixture();
		const sourceFile = join(root, "packages/core/src/index.ts");
		const distFile = join(root, "packages/core/dist/index.js");
		mkdirSync(dirname(distFile), { recursive: true });
		writeFileSync(distFile, "export const DIAGNOSTIC_REGISTRY = {};\n");
		const oldTime = new Date("2020-01-01T00:00:00.000Z");
		const newTime = new Date("2021-01-01T00:00:00.000Z");
		utimesSync(distFile, oldTime, oldTime);
		utimesSync(sourceFile, newTime, newTime);

		assertFreshnessFailure(runCheck(root));
	});
});
