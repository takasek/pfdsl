import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readShell } from "./shell-commands.mjs";

test("parser permits a transient delay beyond the former one-second limit", () => {
	const root = mkdtempSync(
		fileURLToPath(
			new URL("../../node_modules/pfdsl-slow-parser-", import.meta.url),
		),
	);
	try {
		const parserPath = join(root, "parser");
		writeFileSync(
			parserPath,
			`#!${process.execPath}\nsetTimeout(() => console.log(JSON.stringify({ Type: 'File' })), 1200);\n`,
		);
		chmodSync(parserPath, 0o755);
		const parsed = readShell("git status", { parserPath });
		assert.equal(parsed.error, undefined);
		assert.deepEqual(parsed.commands, []);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("shfmt reads ordinary transcript shapes without executing them", () => {
	for (const source of [
		"diff <(git show HEAD:a) a",
		"echo $((1+2)); git commit -m x",
		'while read -r f; do git add "$f"; done < list',
		"pushd /tmp; ls; popd; git add a",
	]) {
		const parsed = readShell(source);
		assert.equal(parsed.error, undefined, source);
		assert.ok(parsed.commands.some(({ tokens }) => tokens[0]?.value === "git"));
	}
});

test("a dynamic executable is retained in the command list", () => {
	const parsed = readShell("git commit --no-verify -m x; $cmd");
	assert.equal(parsed.commands.length, 2);
	assert.equal(parsed.commands[1].tokens[0].dynamic, true);
});

test("data heredocs accept ordinary Git global options before the subcommand", () => {
	for (const source of [
		"git -C /fixture/own commit -F - <<'EOF'\nmessage\nEOF",
		"git -C /fixture/own -c color.ui=never commit -F - <<'EOF'\ngit commit --no-verify -m example\nEOF",
	]) {
		const parsed = readShell(source);
		assert.equal(parsed.error, undefined, source);
		assert.equal(parsed.commands.length, 1, source);
	}
});

test("missing parser and syntax errors have distinct recovery facts", () => {
	const missing = readShell("git status", {
		parserPath: "/nonexistent/pfdsl-shfmt",
	});
	assert.equal(missing.failure, "parser-missing");
	assert.equal(missing.commands, undefined);
	assert.equal(readShell("if then").failure, "syntax");
});

test("unsupported shell constructs report an error", () => {
	for (const source of [
		"git commit --no-verify -m x; repeat 2 echo x",
		"git commit --no-verify -m x; python <<'EOF'\nprint('x')\nEOF",
		"git commit --no-verify -m x; if then",
	]) {
		assert.equal(readShell(source).failure, "syntax", source);
	}
	const parsed = readShell("git commit --no-verify -m x; repeat 2 echo x");
	assert.equal(parsed.failure, "syntax");
	assert.ok(
		parsed.commands?.some(({ tokens }) =>
			tokens.some(({ value }) => value === "--no-verify"),
		),
	);
});
