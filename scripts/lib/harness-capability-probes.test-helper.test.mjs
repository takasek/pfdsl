import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { pruneGitIgnoredFixtureEntries } from "./harness-capability-probes.test-helper.mjs";

/** A throwaway git repository with a `.gitignore`, for exercising `check-ignore`. */
function makeSourceRepo({ gitignore = ".DS_Store\n" } = {}) {
	const root = mkdtempSync(join(tmpdir(), "prune-git-ignored-source-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, ".gitignore"), gitignore);
	mkdirSync(join(root, ".claude"), { recursive: true });
	writeFileSync(join(root, ".claude", "settings.json"), "{}");
	return root;
}

describe("pruneGitIgnoredFixtureEntries", () => {
	it("removes copied entries the source repo git-ignores, and keeps the rest", () => {
		const sourceRoot = makeSourceRepo();
		const consumerRoot = mkdtempSync(
			join(tmpdir(), "prune-git-ignored-consumer-"),
		);
		try {
			mkdirSync(join(consumerRoot, ".claude"), { recursive: true });
			writeFileSync(join(consumerRoot, ".claude", ".DS_Store"), "binary-junk");
			writeFileSync(join(consumerRoot, ".claude", "settings.json"), "{}");

			pruneGitIgnoredFixtureEntries(sourceRoot, [
				{
					sourceRelative: ".claude",
					consumerPath: join(consumerRoot, ".claude"),
				},
			]);

			assert.equal(
				existsSync(join(consumerRoot, ".claude", ".DS_Store")),
				false,
			);
			assert.equal(
				existsSync(join(consumerRoot, ".claude", "settings.json")),
				true,
			);
		} finally {
			rmSync(sourceRoot, { recursive: true, force: true });
			rmSync(consumerRoot, { recursive: true, force: true });
		}
	});

	for (const name of [
		"日本語.tmp",
		"line\nbreak.tmp",
		'quote".tmp',
		"space name.tmp",
	]) {
		it(`prunes ignored paths without corrupting ${JSON.stringify(name)}`, () => {
			const sourceRoot = makeSourceRepo({ gitignore: "*.tmp\n" });
			const consumerRoot = mkdtempSync(join(tmpdir(), "prune-path-encoding-"));
			try {
				const copiedRoot = join(consumerRoot, ".claude");
				mkdirSync(copiedRoot);
				writeFileSync(join(copiedRoot, name), "ignored");
				writeFileSync(join(copiedRoot, "keep.json"), "{}");
				pruneGitIgnoredFixtureEntries(sourceRoot, [
					{ sourceRelative: ".claude", consumerPath: copiedRoot },
				]);
				assert.equal(existsSync(join(copiedRoot, name)), false);
				assert.equal(existsSync(join(copiedRoot, "keep.json")), true);
			} finally {
				rmSync(sourceRoot, { recursive: true, force: true });
				rmSync(consumerRoot, { recursive: true, force: true });
			}
		});
	}

	it("removes an ignored directory as a whole, not just the files inside it", () => {
		const sourceRoot = makeSourceRepo({ gitignore: "dist/\n" });
		const consumerRoot = mkdtempSync(
			join(tmpdir(), "prune-git-ignored-consumer-"),
		);
		try {
			mkdirSync(join(consumerRoot, ".claude", "dist"), { recursive: true });
			writeFileSync(join(consumerRoot, ".claude", "dist", "x.txt"), "junk");
			writeFileSync(join(consumerRoot, ".claude", "keep.json"), "{}");

			pruneGitIgnoredFixtureEntries(sourceRoot, [
				{
					sourceRelative: ".claude",
					consumerPath: join(consumerRoot, ".claude"),
				},
			]);

			assert.equal(existsSync(join(consumerRoot, ".claude", "dist")), false);
			assert.equal(
				existsSync(join(consumerRoot, ".claude", "keep.json")),
				true,
			);
		} finally {
			rmSync(sourceRoot, { recursive: true, force: true });
			rmSync(consumerRoot, { recursive: true, force: true });
		}
	});

	it("throws on a directory symlink instead of silently missing what's beyond it", () => {
		const sourceRoot = makeSourceRepo();
		const consumerRoot = mkdtempSync(
			join(tmpdir(), "prune-git-ignored-consumer-"),
		);
		try {
			mkdirSync(join(consumerRoot, ".claude"), { recursive: true });
			const realDir = join(consumerRoot, "real-target");
			mkdirSync(realDir, { recursive: true });
			symlinkSync(realDir, join(consumerRoot, ".claude", "linked"), "dir");

			assert.throws(() => {
				pruneGitIgnoredFixtureEntries(sourceRoot, [
					{
						sourceRelative: ".claude",
						consumerPath: join(consumerRoot, ".claude"),
					},
				]);
			}, /symlink/);
		} finally {
			rmSync(sourceRoot, { recursive: true, force: true });
			rmSync(consumerRoot, { recursive: true, force: true });
		}
	});

	it("throws instead of silently skipping when git check-ignore fails abnormally", () => {
		const notAGitRepo = mkdtempSync(
			join(tmpdir(), "prune-git-ignored-nongit-"),
		);
		const consumerRoot = mkdtempSync(
			join(tmpdir(), "prune-git-ignored-consumer-"),
		);
		try {
			mkdirSync(join(consumerRoot, ".claude"), { recursive: true });
			writeFileSync(join(consumerRoot, ".claude", "settings.json"), "{}");

			assert.throws(() => {
				pruneGitIgnoredFixtureEntries(notAGitRepo, [
					{
						sourceRelative: ".claude",
						consumerPath: join(consumerRoot, ".claude"),
					},
				]);
			});
		} finally {
			rmSync(notAGitRepo, { recursive: true, force: true });
			rmSync(consumerRoot, { recursive: true, force: true });
		}
	});
});
