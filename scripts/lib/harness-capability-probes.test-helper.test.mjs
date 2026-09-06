import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { pruneGitIgnoredFixtureEntries } from "./harness-capability-probes.test-helper.mjs";

/** A throwaway git repository with a `.gitignore`, for exercising `check-ignore`. */
function makeSourceRepo() {
	const root = mkdtempSync(join(tmpdir(), "prune-git-ignored-source-"));
	execFileSync("git", ["init", "-q"], { cwd: root });
	writeFileSync(join(root, ".gitignore"), ".DS_Store\n");
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
