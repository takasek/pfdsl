import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
	commitEverything,
	makeGitRepository,
} from "./git-test-repository.test-helper.mjs";
import { listUntrackedFiles } from "./git-untracked-files.mjs";

describe("listUntrackedFiles", () => {
	it("lists only untracked, unignored files under the given roots as absolute paths", () => {
		const root = makeGitRepository({
			prefix: "git-untracked-files-",
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
			prefix: "git-untracked-files-",
			repository: false,
		});
		try {
			assert.throws(() => listUntrackedFiles(root, [root]), /git ls-files/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
