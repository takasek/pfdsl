import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { withIndexSnapshot } from "./index-snapshot.mjs";

function fixture(run) {
	const root = mkdtempSync(join(tmpdir(), "index-snapshot-test-"));
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" });
	const write = (path, value) => {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), value);
	};
	try {
		git("init", "--quiet");
		write(".gitignore", "dist/\nnode_modules/\n");
		write("packages/core/package.json", '{"name":"@pfdsl/core"}\n');
		write("packages/core/src/index.js", "export {};\n");
		write("tsconfig.base.json", "{}\n");
		git("add", ".");
		run({ root, git, write });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

it("exports an unborn index with no history", () =>
	fixture(({ root }) => {
		const before = readFileSync(join(root, ".git/index"));
		withIndexSnapshot(root, (snapshot) =>
			assert.equal(
				readFileSync(join(snapshot, "tsconfig.base.json"), "utf8"),
				"{}\n",
			),
		);
		assert.deepEqual(readFileSync(join(root, ".git/index")), before);
	}));

it("exports a split index without modifying it", () =>
	fixture(({ root, git }) => {
		git(
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-qm",
			"test: base",
		);
		git("update-index", "--split-index");
		const before = readFileSync(join(root, ".git/index"));
		withIndexSnapshot(root, (snapshot) =>
			assert.equal(
				readFileSync(join(snapshot, "packages/core/src/index.js"), "utf8"),
				"export {};\n",
			),
		);
		assert.deepEqual(readFileSync(join(root, ".git/index")), before);
	}));

it("exports newly staged objects from a shallow clone", () =>
	fixture(({ root, git }) => {
		git(
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-qm",
			"test: base",
		);
		const shallow = join(root, "shallow");
		git("clone", "--quiet", "--depth=1", `file://${root}`, shallow);
		writeFileSync(join(shallow, "tsconfig.base.json"), '{"strict":true}\n');
		execFileSync("git", ["add", "tsconfig.base.json"], { cwd: shallow });
		const before = readFileSync(join(shallow, ".git/index"));
		withIndexSnapshot(shallow, (snapshot) =>
			assert.equal(
				readFileSync(join(snapshot, "tsconfig.base.json"), "utf8"),
				'{"strict":true}\n',
			),
		);
		assert.deepEqual(readFileSync(join(shallow, ".git/index")), before);
	}));

for (const cache of [".vite", ".cache"]) {
	it(`keeps dependency ${cache} writes inside the snapshot`, () =>
		fixture(({ root, write }) => {
			const path = `packages/core/node_modules/${cache}/results.json`;
			write(path, "original cache\n");
			withIndexSnapshot(root, (snapshot) => {
				mkdirSync(join(snapshot, path, ".."), { recursive: true });
				writeFileSync(join(snapshot, path), "new isolated cache\n");
			});
			assert.equal(readFileSync(join(root, path), "utf8"), "original cache\n");
		}));
}

for (const kind of ["unstaged", "staged-unbuilt", "deleted"]) {
	it(`does not reuse dist with ${kind} shared build inputs`, () =>
		fixture(({ root, git, write }) => {
			write("packages/core/dist/index.js", "old build\n");
			if (kind === "deleted") rmSync(join(root, "tsconfig.base.json"));
			else {
				write("tsconfig.base.json", '{"strict":true}\n');
				utimesSync(
					join(root, "tsconfig.base.json"),
					new Date(Date.now() + 1000),
					new Date(Date.now() + 1000),
				);
				if (kind === "staged-unbuilt") git("add", "tsconfig.base.json");
			}
			withIndexSnapshot(root, (snapshot) =>
				assert.equal(
					existsSync(join(snapshot, "packages/core/dist/index.js")),
					false,
				),
			);
		}));
}

it("reuses a fresh build when package inputs match the index", () =>
	fixture(({ root, write }) => {
		write("packages/core/dist/index.js", "matching build\n");
		const builtAt = new Date(Date.now() + 2000);
		utimesSync(join(root, "packages/core/dist/index.js"), builtAt, builtAt);
		withIndexSnapshot(root, (snapshot) =>
			assert.equal(
				readFileSync(join(snapshot, "packages/core/dist/index.js"), "utf8"),
				"matching build\n",
			),
		);
	}));

for (const directory of ["src", "scripts"]) {
	for (const kind of [
		"unstaged",
		"untracked",
		"staged-for-head",
		"staged-unbuilt",
	]) {
		it(`does not reuse dist with ${kind} package ${directory} inputs`, () =>
			fixture(({ root, git, write }) => {
				const input = `packages/core/${directory}/nested/input.js`;
				write(input, "export {};\n");
				git("add", input);
				const committed = kind === "staged-for-head";
				if (committed)
					git(
						"-c",
						"user.name=test",
						"-c",
						"user.email=test@example.com",
						"commit",
						"-qm",
						"test: base",
					);
				const changed = kind === "untracked" ? `${input}.new.js` : input;
				write(changed, "export const changed = true;\n");
				const changedAt = new Date(Date.now() + 1000);
				utimesSync(join(root, changed), changedAt, changedAt);
				if (committed || kind === "staged-unbuilt") git("add", changed);
				write("packages/core/dist/index.js", "build from changed inputs\n");
				const builtAt = new Date(
					Date.now() + (kind === "staged-unbuilt" ? 0 : 2000),
				);
				utimesSync(join(root, "packages/core/dist/index.js"), builtAt, builtAt);
				const before = readFileSync(join(root, ".git/index"));
				withIndexSnapshot(
					root,
					(snapshot) =>
						assert.equal(
							existsSync(join(snapshot, "packages/core/dist/index.js")),
							false,
						),
					process.env,
					{ committed },
				);
				assert.deepEqual(readFileSync(join(root, ".git/index")), before);
			}));
	}
}
