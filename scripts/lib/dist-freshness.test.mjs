import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDistStale } from "./dist-freshness.mjs";

describe("isDistStale", () => {
	let root;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "dist-freshness-"));
		mkdirSync(join(root, "src"), { recursive: true });
		mkdirSync(join(root, "dist"), { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("is stale when the dist file does not exist", () => {
		writeFileSync(join(root, "src", "index.ts"), "x");
		assert.equal(isDistStale(join(root, "dist", "cli.js")), true);
	});

	it("is fresh when dist is newer than every src file", () => {
		const srcFile = join(root, "src", "index.ts");
		const distFile = join(root, "dist", "cli.js");
		writeFileSync(srcFile, "x");
		writeFileSync(distFile, "y");
		const past = new Date(Date.now() - 60_000);
		const now = new Date();
		utimesSync(srcFile, past, past);
		utimesSync(distFile, now, now);
		assert.equal(isDistStale(distFile), false);
	});

	it("is stale when a src file was modified after dist was built", () => {
		const srcFile = join(root, "src", "index.ts");
		const distFile = join(root, "dist", "cli.js");
		writeFileSync(distFile, "y");
		const past = new Date(Date.now() - 60_000);
		const now = new Date();
		utimesSync(distFile, past, past);
		writeFileSync(srcFile, "x");
		utimesSync(srcFile, now, now);
		assert.equal(isDistStale(distFile), true);
	});

	it("detects staleness from a nested src file", () => {
		const nestedDir = join(root, "src", "nested");
		mkdirSync(nestedDir, { recursive: true });
		const nestedFile = join(nestedDir, "deep.ts");
		const distFile = join(root, "dist", "cli.js");
		writeFileSync(distFile, "y");
		const past = new Date(Date.now() - 60_000);
		const now = new Date();
		utimesSync(distFile, past, past);
		writeFileSync(nestedFile, "x");
		utimesSync(nestedFile, now, now);
		assert.equal(isDistStale(distFile), true);
	});

	it("is fresh when the sibling src/ directory does not exist", () => {
		rmSync(join(root, "src"), { recursive: true, force: true });
		const distFile = join(root, "dist", "cli.js");
		writeFileSync(distFile, "y");
		assert.equal(isDistStale(distFile), false);
	});
});
