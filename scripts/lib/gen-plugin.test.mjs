import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPluginManifest, mirrorDir, mirrorFiles } from "./gen-plugin.mjs";

describe("buildPluginManifest", () => {
	it("uses the CLI version as the plugin version", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.version, "0.0.18");
	});

	it("names the plugin pfdsl", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.name, "pfdsl");
	});

	it("declares the MIT license", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.equal(manifest.license, "MIT");
	});

	it("mentions the pfd-ops skill in the description", () => {
		const manifest = buildPluginManifest({ cliVersion: "0.0.18" });
		assert.match(manifest.description, /pfd-ops/);
	});
});

let tmp;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "gen-plugin-"));
});

afterEach(() => {
	rmSync(tmp, { recursive: true, force: true });
});

describe("mirrorDir", () => {
	it("copies a directory tree into the destination", () => {
		const src = join(tmp, "src", "foo");
		mkdirSync(join(src, "nested"), { recursive: true });
		writeFileSync(join(src, "a.txt"), "a");
		writeFileSync(join(src, "nested", "b.txt"), "b");
		const destRoot = join(tmp, "dest");

		mirrorDir("foo", join(tmp, "src"), destRoot);

		assert.equal(readFileSync(join(destRoot, "foo", "a.txt"), "utf-8"), "a");
		assert.equal(readFileSync(join(destRoot, "foo", "nested", "b.txt"), "utf-8"), "b");
	});

	it("removes a stale destination file that no longer exists in the source", () => {
		const src = join(tmp, "src", "foo");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "a.txt"), "a");
		const destRoot = join(tmp, "dest");
		mkdirSync(join(destRoot, "foo"), { recursive: true });
		writeFileSync(join(destRoot, "foo", "stale.txt"), "leftover from a prior run");

		mirrorDir("foo", join(tmp, "src"), destRoot);

		assert.equal(existsSync(join(destRoot, "foo", "stale.txt")), false);
		assert.equal(readFileSync(join(destRoot, "foo", "a.txt"), "utf-8"), "a");
	});

	it("exits with an error when the source directory is missing", () => {
		assert.throws(() => mirrorDir("missing", join(tmp, "src"), join(tmp, "dest")), /not found/);
	});

	it("excludes a top-level CLAUDE.md dev-only guard from the mirrored copy", () => {
		const src = join(tmp, "src", "foo");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "SKILL.md"), "skill body");
		writeFileSync(join(src, "CLAUDE.md"), "dev-only guard, never ship this");
		const destRoot = join(tmp, "dest");

		mirrorDir("foo", join(tmp, "src"), destRoot);

		assert.equal(existsSync(join(destRoot, "foo", "CLAUDE.md")), false);
		assert.equal(readFileSync(join(destRoot, "foo", "SKILL.md"), "utf-8"), "skill body");
	});

	it("keeps the prior destination content when the source copy fails partway", (t) => {
		// A source directory containing an unreadable nested file makes cpSync
		// throw partway through a recursive copy — a portable stand-in for any
		// mid-copy failure (disk full, permission change, concurrent deletion).
		// root ignores permission bits, so this fault injection can't trigger
		// there; skip rather than false-fail (#509).
		if (process.getuid?.() === 0) {
			t.skip("root ignores chmod 0o000, so this fault injection can't fail the copy");
			return;
		}
		const src = join(tmp, "src", "foo");
		mkdirSync(src, { recursive: true });
		writeFileSync(join(src, "a.txt"), "new-a");
		writeFileSync(join(src, "unreadable.txt"), "x");
		chmodSync(join(src, "unreadable.txt"), 0o000);

		const destRoot = join(tmp, "dest");
		mkdirSync(join(destRoot, "foo"), { recursive: true });
		writeFileSync(join(destRoot, "foo", "a.txt"), "prior-good-a");

		try {
			assert.throws(() => mirrorDir("foo", join(tmp, "src"), destRoot));
		} finally {
			chmodSync(join(src, "unreadable.txt"), 0o644);
		}

		assert.equal(readFileSync(join(destRoot, "foo", "a.txt"), "utf-8"), "prior-good-a");
	});
});

describe("mirrorFiles", () => {
	it("copies each named file into the destination", () => {
		const srcDir = join(tmp, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, "one.md"), "one");
		writeFileSync(join(srcDir, "two.md"), "two");
		const destDir = join(tmp, "dest");

		mirrorFiles(["one.md", "two.md"], srcDir, destDir);

		assert.equal(readFileSync(join(destDir, "one.md"), "utf-8"), "one");
		assert.equal(readFileSync(join(destDir, "two.md"), "utf-8"), "two");
	});

	it("removes a stale destination file no longer in the current file list", () => {
		const srcDir = join(tmp, "src");
		mkdirSync(srcDir, { recursive: true });
		writeFileSync(join(srcDir, "one.md"), "one");
		const destDir = join(tmp, "dest");
		mkdirSync(destDir, { recursive: true });
		writeFileSync(join(destDir, "stale.md"), "leftover from a prior run");

		mirrorFiles(["one.md"], srcDir, destDir);

		assert.equal(existsSync(join(destDir, "stale.md")), false);
		assert.equal(readFileSync(join(destDir, "one.md"), "utf-8"), "one");
	});

	it("exits with an error when a named source file is missing", () => {
		const srcDir = join(tmp, "src");
		mkdirSync(srcDir, { recursive: true });
		assert.throws(() => mirrorFiles(["missing.md"], srcDir, join(tmp, "dest")), /not found/);
	});
});
