import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
	findShellExecutors,
	selectScannedFiles,
} from "./check-no-shell-strings.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("findShellExecutors", () => {
	it("flags importing execSync", () => {
		const found = findShellExecutors(
			'import { execSync } from "node:child_process";',
		);
		assert.equal(found.length, 1);
	});

	it("flags the bare child_process specifier as well as the node: one", () => {
		assert.equal(
			findShellExecutors('import { execSync } from "child_process";').length,
			1,
		);
	});

	it("flags an aliased import, which the name on the left still identifies", () => {
		const found = findShellExecutors(
			'import { execSync as sh } from "node:child_process";',
		);
		assert.equal(found.length, 1);
	});

	it("flags async exec too, which runs through a shell just the same", () => {
		assert.equal(
			findShellExecutors('import { exec } from "node:child_process";').length,
			1,
		);
	});

	it("flags imports that expose the entire child_process module", () => {
		for (const source of [
			'import cp from "node:child_process";',
			'import * as cp from "child_process";',
			'const cp = await import("node:child_process");',
			'const cp = await import(("node:child_process"));',
			'const cp = (require)(("node:child_process"));',
		])
			assert.equal(findShellExecutors(source).length, 1, source);
	});

	it("flags literal shell options across quoted, computed and multiline syntax", () => {
		for (const source of [
			'execFileSync(cmd, { "shell": true });',
			"execFileSync(cmd, { shell: (true) });",
			'execFileSync(cmd, { ["shell"]: true });',
			"execFileSync(cmd, { shell:\n true });",
		])
			assert.equal(findShellExecutors(source).length, 1, source);
	});

	// Node takes a shell path for `shell` too, and any truthy value turns the
	// shell on, so a non-empty string is the same hazard as `true`.
	it("flags a non-empty string shell option, which names the shell to run through", () => {
		for (const source of [
			'execFileSync(cmd, { shell: "/bin/sh" });',
			"execFileSync(cmd, { shell: '/bin/sh' });",
			"execFileSync(cmd, { shell: `/bin/sh` });",
			'execFileSync(cmd, { shell: ("/bin/sh") });',
			'execFileSync(cmd, { "shell": "/bin/sh" });',
			'execFileSync(cmd, { ["shell"]: "/bin/sh" });',
		])
			assert.equal(findShellExecutors(source).length, 1, source);
	});

	it("leaves shell options alone that Node treats as no shell", () => {
		for (const source of [
			"execFileSync(cmd, { shell: false });",
			'execFileSync(cmd, { shell: "" });',
		])
			assert.deepEqual(findShellExecutors(source), [], source);
	});

	it("flags re-exporting the entire child_process module", () => {
		for (const source of [
			'export * from "node:child_process";',
			'export * from "child_process";',
			'export * as cp from "node:child_process";',
		]) {
			const found = findShellExecutors(source);
			assert.equal(found.length, 1, source);
			assert.match(found[0].reason, /re-exports the child_process module/);
		}
	});

	it("flags re-exporting a shell-executing name, under any alias", () => {
		for (const [source, name] of [
			['export { exec } from "node:child_process";', "exec"],
			['export { execSync } from "child_process";', "execSync"],
			['export { execSync as run } from "node:child_process";', "execSync"],
		]) {
			const found = findShellExecutors(source);
			assert.equal(found.length, 1, source);
			assert.match(found[0].reason, new RegExp(`re-exports ${name} from`));
		}
	});

	// The default export of child_process is the whole module, so naming it
	// through a specifier list hands over exec just as `import cp from` does.
	it("flags the default export of child_process, which is the whole module", () => {
		for (const [source, reason] of [
			[
				'import { default as cp } from "node:child_process";',
				/imports the child_process module/,
			],
			[
				'export { default as cp } from "node:child_process";',
				/re-exports the child_process module/,
			],
			[
				'export { default } from "child_process";',
				/re-exports the child_process module/,
			],
		]) {
			const found = findShellExecutors(source);
			assert.equal(found.length, 1, source);
			assert.match(found[0].reason, reason);
		}
	});

	it("leaves a re-export alone that takes argv or comes from elsewhere", () => {
		for (const source of [
			'export { execFileSync } from "node:child_process";',
			'export { execFileSync, spawnSync } from "node:child_process";',
			'export { exec } from "./not-child-process.mjs";',
			"const exec = 1;\nexport { exec };",
		])
			assert.deepEqual(findShellExecutors(source), [], source);
	});

	it("does not interpret comments or strings as executable syntax", () => {
		assert.deepEqual(
			findShellExecutors(`
// import { execSync } from "node:child_process";
const example = 'execFileSync(cmd, { shell: true });';
/* shell: true */
`),
			[],
		);
	});

	it("leaves execFileSync alone, which takes argv", () => {
		assert.deepEqual(
			findShellExecutors('import { execFileSync } from "node:child_process";'),
			[],
		);
	});

	it("leaves an argv-taking import list alone even when it is long", () => {
		assert.deepEqual(
			findShellExecutors(
				'import { execFileSync, spawnSync } from "node:child_process";',
			),
			[],
		);
	});

	it("flags only the shell-executing name in a mixed import list", () => {
		const found = findShellExecutors(
			'import { execFileSync, execSync } from "node:child_process";',
		);
		assert.equal(found.length, 1);
		assert.match(found[0].reason, /execSync/);
	});

	it("flags require of child_process, which hands over the whole module", () => {
		const found = findShellExecutors(
			'const cp = require("node:child_process");',
		);
		assert.equal(found.length, 1);
	});

	it("flags shell: true, which makes an argv-taking call run a command line", () => {
		const found = findShellExecutors("execFileSync(cmd, { shell: true });");
		assert.equal(found.length, 1);
		assert.match(found[0].reason, /shell: true/);
	});

	it("catches the evasion of assigning the command to a variable first", () => {
		// The point of banning the import: no argument analysis to slip past.
		const source =
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source under test, not an interpolation
			'import { execSync } from "node:child_process";\nconst cmd = `git show ${ref}`;\nexecSync(cmd);';
		assert.equal(findShellExecutors(source).length, 1);
	});

	it("reports the line the import is on", () => {
		const found = findShellExecutors(
			'const a = 1;\n\nimport { execSync } from "node:child_process";',
		);
		assert.equal(found[0].line, 3);
	});

	it("passes a file that only uses the shared runner", () => {
		assert.deepEqual(
			findShellExecutors(
				'import { git } from "./lib/run-exec.mjs";\ngit(["show", ref]);',
			),
			[],
		);
	});
});

describe("selectScannedFiles", () => {
	it("scans a script outside scripts/, which an enumerated glob list would miss", () => {
		assert.deepEqual(
			selectScannedFiles(["hooks/managed-issue-reminder-post-tool-use.mjs"]),
			["hooks/managed-issue-reminder-post-tool-use.mjs"],
		);
	});

	it("scans a directory nobody has created yet, so a new one needs no glob edit", () => {
		assert.deepEqual(selectScannedFiles(["tools/release/publish.mjs"]), [
			"tools/release/publish.mjs",
		]);
	});

	it("scans scripts/ at both its top level and nested", () => {
		const files = ["scripts/gate-check.mjs", "scripts/pfdsl/lib/gh-exec.mjs"];
		assert.deepEqual(selectScannedFiles(files), files);
	});

	it("skips test files, which hold the offending patterns as data", () => {
		assert.deepEqual(
			selectScannedFiles(["scripts/lib/gate-check.test.mjs"]),
			[],
		);
	});

	it("skips the detector itself, whose patterns name the banned imports", () => {
		assert.deepEqual(
			selectScannedFiles(["scripts/lib/check-no-shell-strings.mjs"]),
			[],
		);
	});

	it("skips the generated plugin mirror, whose sources are scanned and whose identity is gated", () => {
		const files = [
			"plugin/pfdsl/hooks/managed-issue-reminder-post-tool-use.mjs",
			"hooks/managed-issue-reminder-post-tool-use.mjs",
		];
		assert.deepEqual(selectScannedFiles(files), [
			"hooks/managed-issue-reminder-post-tool-use.mjs",
		]);
	});

	it("skips non-.mjs files", () => {
		assert.deepEqual(
			selectScannedFiles(["scripts/pre-commit", "packages/cli/src/index.ts"]),
			[],
		);
	});
});

describe("the repository's own scan set", () => {
	/** Every tracked `.mjs` path, repo-relative — the candidates the gate filters. */
	const tracked = execFileSync("git", ["ls-files", "*.mjs"], {
		cwd: root,
		encoding: "utf-8",
	})
		.split("\n")
		.filter(Boolean);

	it("covers every tracked .mjs that is not excluded on purpose", () => {
		const scanned = new Set(selectScannedFiles(tracked));
		const missed = tracked.filter(
			(f) =>
				!scanned.has(f) &&
				!f.endsWith(".test.mjs") &&
				!f.startsWith("plugin/") &&
				f !== "scripts/lib/check-no-shell-strings.mjs",
		);
		assert.deepEqual(
			missed,
			[],
			`outside the gate's reach: ${missed.join(", ")}`,
		);
	});

	it("reaches hooks/, which runs on every Bash tool call in an adopting repo", () => {
		assert.ok(
			selectScannedFiles(tracked).includes(
				"hooks/managed-issue-reminder-post-tool-use.mjs",
			),
		);
	});
});
