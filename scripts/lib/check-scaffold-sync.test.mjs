import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkScaffoldSync } from "./check-scaffold-sync.mjs";

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "check-scaffold-sync-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

function writeFile(root, relPath, content) {
	const full = join(root, ...relPath.split("/"));
	mkdirSync(join(full, ".."), { recursive: true });
	writeFileSync(full, content);
}

describe("checkScaffoldSync", () => {
	it("reports ok when canonical and deployed match byte-for-byte", () => {
		const canonicalDir = join(tmp, "canonical");
		const deployedDir = join(tmp, "deployed");
		writeFile(canonicalDir, "roadmap.md", "same");
		writeFile(deployedDir, "roadmap.md", "same");

		const results = checkScaffoldSync(canonicalDir, deployedDir);
		assert.deepEqual(results, [{ path: "roadmap.md", status: "ok" }]);
	});

	it("reports modified when the deployed copy diverges from canonical", () => {
		const canonicalDir = join(tmp, "canonical");
		const deployedDir = join(tmp, "deployed");
		writeFile(canonicalDir, "roadmap.md", "plugin-side edit");
		writeFile(deployedDir, "roadmap.md", "repo-local edit");

		const results = checkScaffoldSync(canonicalDir, deployedDir);
		assert.deepEqual(results, [{ path: "roadmap.md", status: "modified" }]);
	});

	it("reports missing when a canonical file has no deployed counterpart", () => {
		const canonicalDir = join(tmp, "canonical");
		const deployedDir = join(tmp, "deployed");
		writeFile(canonicalDir, "bindings/pfd-ops.md", "new file");
		mkdirSync(deployedDir, { recursive: true });

		const results = checkScaffoldSync(canonicalDir, deployedDir);
		assert.deepEqual(results, [{ path: "bindings/pfd-ops.md", status: "missing" }]);
	});

	it("compares every nested file independently", () => {
		const canonicalDir = join(tmp, "canonical");
		const deployedDir = join(tmp, "deployed");
		writeFile(canonicalDir, "a.md", "same-a");
		writeFile(deployedDir, "a.md", "same-a");
		writeFile(canonicalDir, "bindings/b.md", "canonical-b");
		writeFile(deployedDir, "bindings/b.md", "drifted-b");

		const results = checkScaffoldSync(canonicalDir, deployedDir);
		const byPath = Object.fromEntries(results.map((r) => [r.path, r.status]));
		assert.equal(byPath["a.md"], "ok");
		assert.equal(byPath["bindings/b.md"], "modified");
	});
});
