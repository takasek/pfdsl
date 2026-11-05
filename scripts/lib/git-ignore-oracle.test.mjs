import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createGitIgnoreOracle } from "./git-ignore-oracle.mjs";
import {
	commitEverything,
	makeGitRepository,
} from "./git-test-repository.test-helper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeRepository(options = {}) {
	return makeGitRepository({ prefix: "git-ignore-oracle-", ...options });
}

describe("createGitIgnoreOracle", () => {
	it("reports a directory an ignore rule matches, and its untracked neighbours", () => {
		const root = makeRepository();
		try {
			mkdirSync(join(root, "sub/dist"), { recursive: true });
			writeFileSync(join(root, "sub/dist/x.txt"), "build output\n");
			writeFileSync(join(root, "sub/keep.md"), "maintained\n");
			const isIgnored = createGitIgnoreOracle(root);

			assert.equal(isIgnored("sub/dist/"), true);
			assert.equal(isIgnored("sub/dist/x.txt"), true);
			assert.equal(isIgnored("sub/keep.md"), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports a tracked path as maintained even when a rule matches its name", () => {
		const root = makeRepository();
		try {
			mkdirSync(join(root, "sub/dist"), { recursive: true });
			writeFileSync(join(root, "sub/dist/x.txt"), "maintained\n");
			commitEverything(root);

			assert.equal(createGitIgnoreOracle(root)("sub/dist/"), false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("answers from the repository's own rules, not the caller's global ignore list", () => {
		// Otherwise whether an undeclared path passes depends on whose machine
		// asked: a maintainer with the name in ~/.config/git/ignore would see it
		// wave through where CI reports it.
		const root = makeRepository();
		const home = makeGitRepository({
			prefix: "git-ignore-oracle-home-",
			repository: false,
		});
		const savedGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
		try {
			writeFileSync(join(home, "ignore"), "mystery.md\n");
			writeFileSync(
				join(home, "gitconfig"),
				`[core]\n\texcludesFile = ${join(home, "ignore")}\n`,
			);
			writeFileSync(join(root, "mystery.md"), "undeclared\n");
			process.env.GIT_CONFIG_GLOBAL = join(home, "gitconfig");

			assert.equal(createGitIgnoreOracle(root)("mystery.md"), false);
		} finally {
			if (savedGlobalConfig === undefined) {
				delete process.env.GIT_CONFIG_GLOBAL;
			} else {
				process.env.GIT_CONFIG_GLOBAL = savedGlobalConfig;
			}
			rmSync(root, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		}
	});

	it("asks Git once per distinct path", () => {
		const asked = [];
		const isIgnored = createGitIgnoreOracle("/repo", {
			checkIgnore: (root, queryPath) => {
				asked.push([root, queryPath]);
				return queryPath === "dist/" ? 0 : 1;
			},
		});

		assert.equal(isIgnored("dist/"), true);
		assert.equal(isIgnored("dist/"), true);
		assert.equal(isIgnored("keep.md"), false);

		assert.deepEqual(asked, [
			["/repo", "dist/"],
			["/repo", "keep.md"],
		]);
	});

	it("answers 'not ignored' and stops asking once Git cannot answer", () => {
		// An exit status other than 0 or 1 means the question never reached
		// Git's ignore rules — no binary, or a root outside any repository.
		// Every later path then keeps the classification it already had.
		let calls = 0;
		const isIgnored = createGitIgnoreOracle("/not-a-repository", {
			checkIgnore: () => {
				calls += 1;
				return 128;
			},
		});

		assert.equal(isIgnored("dist/"), false);
		assert.equal(isIgnored("coverage/"), false);
		assert.equal(calls, 1);
	});

	it("spawns one fixed command and takes no executable from its caller", () => {
		// findDistDependentFiles exempts this module from its
		// node:child_process rule on exactly this property: the dist-independent
		// generator's closure reaches it, and a runner that accepted an
		// executable would put the CLI build one argument away.
		const source = readFileSync(
			resolve(__dirname, "git-ignore-oracle.mjs"),
			"utf-8",
		);
		const spawns = [...source.matchAll(/execFileSync\(\s*([^\s,]+)/g)].map(
			([, executable]) => executable,
		);

		assert.deepEqual(spawns, ['"git"']);
		assert.match(source, /"check-ignore"/);
	});
});
