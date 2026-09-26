import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { listTrackedFiles, listUntrackedFiles } from "./git-ls-files.mjs";
import {
	commitEverything,
	makeGitRepository,
} from "./git-test-repository.test-helper.mjs";

describe("listTrackedFiles", () => {
	it("lists only indexed files under the given roots as absolute paths", () => {
		const root = makeGitRepository({ prefix: "git-ls-files-" });
		try {
			mkdirSync(join(root, "owned/sub"), { recursive: true });
			mkdirSync(join(root, "elsewhere"), { recursive: true });
			writeFileSync(join(root, "owned/sub/tracked.md"), "tracked\n");
			writeFileSync(join(root, "elsewhere/tracked.md"), "outside\n");
			commitEverything(root);
			writeFileSync(join(root, "owned/untracked.md"), "untracked\n");

			assert.deepEqual(listTrackedFiles(root, [join(root, "owned")]), [
				join(root, "owned/sub/tracked.md"),
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails instead of reporting nothing when Git cannot answer", () => {
		const root = makeGitRepository({
			prefix: "git-ls-files-",
			repository: false,
		});
		try {
			assert.throws(() => listTrackedFiles(root, [root]), /git ls-files/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("listUntrackedFiles", () => {
	it("lists only untracked, unignored files under the given roots as absolute paths", () => {
		const root = makeGitRepository({
			prefix: "git-ls-files-",
			gitignore: "*.log\n",
		});
		try {
			mkdirSync(join(root, "owned/sub"), { recursive: true });
			mkdirSync(join(root, "elsewhere"), { recursive: true });
			writeFileSync(join(root, "owned/tracked.md"), "tracked\n");
			commitEverything(root);
			writeFileSync(join(root, "owned/sub/hand-placed.md"), "untracked\n");
			writeFileSync(join(root, "owned/debug.log"), "ignored\n");
			writeFileSync(join(root, "elsewhere/note.md"), "outside\n");

			assert.deepEqual(listUntrackedFiles(root, [join(root, "owned")]), [
				join(root, "owned/sub/hand-placed.md"),
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails instead of reporting nothing when Git cannot answer", () => {
		const root = makeGitRepository({
			prefix: "git-ls-files-",
			repository: false,
		});
		try {
			assert.throws(() => listUntrackedFiles(root, [root]), /git ls-files/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
