import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { CLAUDE_GENERATED_CAPABILITY_OUTPUTS } from "./harness-inventory.mjs";
import { decodeHarnessSources } from "./harness-source-decoder.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputs = [
	...CLAUDE_GENERATED_CAPABILITY_OUTPUTS,
	"generated",
	"plugin",
	".agents",
	".codex",
	"CLAUDE.md",
	"AGENTS.md",
	".claude-plugin/marketplace.json",
];

function digest(root, paths) {
	const files = {};
	const visit = (relative) => {
		const path = join(root, relative);
		if (lstatSync(path).isDirectory())
			for (const name of readdirSync(path).sort()) visit(`${relative}/${name}`);
		else
			files[relative] = createHash("sha256")
				.update(readFileSync(path))
				.digest("hex");
	};
	for (const path of paths) visit(path);
	return files;
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-harness-template-"));
	const paths = execFileSync(
		"git",
		[
			"ls-files",
			"-z",
			"--",
			".claude",
			".github",
			"docs",
			"hooks",
			"scripts",
			"generated",
			"plugin",
			".agents",
			".codex",
			".claude-plugin",
			"AGENTS.md",
			"CLAUDE.md",
			"package.json",
			"packages",
			".gitignore",
		],
		{ cwd: repo, encoding: "utf8" },
	)
		.split("\0")
		.filter(Boolean);
	for (const path of paths) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		cpSync(join(repo, path), join(root, path), {
			recursive: true,
			verbatimSymlinks: true,
		});
	}
	cpSync(
		join(repo, "scripts/harness-template"),
		join(root, "scripts/harness-template"),
		{ recursive: true },
	);
	cpSync(
		join(repo, "scripts/lib/harness-template.mjs"),
		join(root, "scripts/lib/harness-template.mjs"),
	);
	symlinkSync(join(repo, "node_modules"), join(root, "node_modules"));
	symlinkSync(
		join(repo, "packages/core/node_modules"),
		join(root, "packages/core/node_modules"),
	);
	for (const name of ["cli", "parser", "renderer", "exporter", "analyzer"]) {
		const source = join(repo, "packages", name, "dist");
		if (existsSync(source))
			symlinkSync(source, join(root, "packages", name, "dist"));
	}
	execFileSync("git", ["init", "--quiet"], { cwd: root });
	return root;
}

function generate(root, entry = "gen-plugin-dist-independent.mjs") {
	const result = spawnSync(process.execPath, [join(root, "scripts", entry)], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
}

it("rebuilds missing Claude outputs from canonical templates and stays byte-stable across both entrypoints", () => {
	const root = fixture();
	try {
		const maintained = digest(root, [
			".claude/settings.json",
			".claude/skills/distribution-review",
			".claude/agents/ci-triage.md",
		]);
		for (const path of [
			...CLAUDE_GENERATED_CAPABILITY_OUTPUTS,
			".claude/commands",
			".agents",
			".codex",
			"plugin",
		])
			rmSync(join(root, path), { recursive: true, force: true });
		generate(root);
		const first = digest(root, outputs);
		execFileSync("git", ["add", "--", ...outputs], { cwd: root });
		generate(root);
		assert.deepEqual(digest(root, outputs), first);
		generate(root, "gen-plugin.mjs");
		assert.deepEqual(digest(root, outputs), first);
		for (const path of [
			...CLAUDE_GENERATED_CAPABILITY_OUTPUTS,
			"generated",
			"plugin",
			".agents",
			".codex",
			"CLAUDE.md",
			"AGENTS.md",
		])
			rmSync(join(root, path), { recursive: true, force: true });
		generate(root, "gen-plugin.mjs");
		assert.deepEqual(digest(root, outputs), first);
		assert.deepEqual(digest(root, Object.keys(maintained)), maintained);
		const claude = readFileSync(
			join(root, ".claude/skills/pfd-ops/SKILL.md"),
			"utf8",
		);
		const codex = readFileSync(
			join(root, ".agents/skills/pfd-ops/SKILL.md"),
			"utf8",
		);
		const frontmatter = (text) => parse(text.match(/^---\n([\s\S]*?)\n---/)[1]);
		assert.equal(
			frontmatter(codex).metadata.summary,
			frontmatter(claude).summary,
		);
		assert.equal(
			frontmatter(codex).description,
			frontmatter(claude).description,
		);
		assert.match(claude, /\.claude\/skills\/pfd-ops\/scripts/);
		assert.match(codex, /\.agents\/skills\/pfd-ops\/scripts/);
		assert.match(
			readFileSync(join(root, ".claude/commands/pfd-cycle.md"), "utf8"),
			/\$ARGUMENTS/,
		);
		assert.doesNotMatch(
			readFileSync(join(root, ".agents/skills/pfd-cycle/SKILL.md"), "utf8"),
			/\$ARGUMENTS/,
		);
		const implementer = readFileSync(
			join(root, ".codex/agents/pfd-implementer.toml"),
			"utf8",
		);
		assert.match(implementer, /親 agent が `git fetch`、stage、commit/);
		assert.doesNotMatch(
			implementer,
			/論理単位でコミットする|コミットとして仕上げる/,
		);
		const lens = readFileSync(
			join(root, ".codex/agents/pfd-lens.toml"),
			"utf8",
		);
		assert.match(lens, /`rg` と `sed`/);
		assert.doesNotMatch(lens, /を Read して|を Read する/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("rejects canonical closure and omitted-branch tag errors, while leaving literal payload examples intact", () => {
	const root = fixture();
	try {
		const source = join(
			root,
			"scripts/harness-template/skills/pfd-grill/SKILL.md",
		);
		const baseline = readFileSync(source, "utf8");
		writeFileSync(source, `${baseline}\n{{#claude}}{{{unknown}}}{{/claude}}`);
		assert.throws(
			() => decodeHarnessSources({ root }),
			/harness-template:.*unknown/,
		);
		writeFileSync(
			source,
			`${baseline}\nQuoted CLAUDE.md and .claude/settings.json.\n`,
		);
		const literal = join(
			root,
			"scripts/harness-template/skills/pfd-retro/references/knowledge-lifecycle.md",
		);
		writeFileSync(literal, "Literal {{example}} and CLAUDE.md.\n");
		generate(root);
		assert.match(
			readFileSync(join(root, ".agents/skills/pfd-grill/SKILL.md"), "utf8"),
			/Quoted CLAUDE.md and \.claude\/settings\.json/,
		);
		assert.match(
			readFileSync(
				join(
					root,
					".agents/skills/pfd-retro/references/knowledge-lifecycle.md",
				),
				"utf8",
			),
			/Literal \{\{example\}\} and CLAUDE.md/,
		);
		writeFileSync(
			join(root, "scripts/harness-template/skills/pfd-grill/undeclared.md"),
			"extra\n",
		);
		assert.throws(
			() => decodeHarnessSources({ root }),
			/source-topology:.*undeclared/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("restores all generated Claude assets after a partial write failure and protects untracked Claude data", () => {
	const root = fixture();
	try {
		generate(root);
		execFileSync("git", ["add", "--", ...outputs], { cwd: root });
		const before = digest(root, outputs);
		const preload = join(root, "fault.cjs");
		writeFileSync(
			preload,
			`const fs = require('node:fs');
const write = fs.writeFileSync;
fs.writeFileSync = (path, ...args) => {
  if (String(path).endsWith('/.claude/commands/pfd-init.md')) throw new Error('injected Claude write failure');
  return write(path, ...args);
};
require('node:module').syncBuiltinESMExports();\n`,
		);
		const result = spawnSync(
			process.execPath,
			[
				"--require",
				preload,
				join(root, "scripts/gen-plugin-dist-independent.mjs"),
			],
			{ cwd: root, encoding: "utf8" },
		);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /injected Claude write failure/);
		assert.deepEqual(digest(root, outputs), before);
		const stray = join(root, ".claude/skills/pfd-grill/local-note.md");
		writeFileSync(stray, "local untracked data\n");
		const lost = spawnSync(
			process.execPath,
			[join(root, "scripts/gen-plugin-dist-independent.mjs")],
			{ cwd: root, encoding: "utf8" },
		);
		assert.equal(lost.status, 1, lost.stderr);
		assert.match(lost.stderr, /delete untracked files/);
		assert.equal(readFileSync(stray, "utf8"), "local untracked data\n");
		rmSync(stray);
		assert.deepEqual(digest(root, outputs), before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
