import assert from "node:assert/strict";
import { test } from "node:test";
import { readShell, shellParseDecision } from "./shell-commands.mjs";

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

test("only a leading literal cd AND chain supplies an execution prefix", () => {
	const prefix = readShell(
		"cd /fixture/own && cd src && git add a && git commit -m x",
	);
	assert.equal(prefix.error, undefined);
	for (const command of prefix.commands.filter(
		({ tokens }) => tokens[0]?.value === "git",
	)) {
		assert.deepEqual(command.leadingCd, ["/fixture/own", "src"]);
		assert.equal(command.unresolvedCwd, false);
	}
	for (const source of [
		"cd /fixture/own; git add a",
		"cd /fixture/own || git add a",
		"(cd /fixture/own && git add a)",
		"if true; then cd /fixture/own && git add a; fi",
		'cd "$target" && git add a',
		"X=1 cd /fixture/own && git add a",
		"X=1 cd /fixture/own; git add a",
		"command cd /fixture/own && git add a",
		"command -p cd /fixture/own; git add a",
		"builtin cd /fixture/own && git add a",
		"noglob cd /fixture/own; git add a",
		"nocorrect cd /fixture/own; git add a",
	]) {
		const parsed = readShell(source);
		assert.equal(parsed.error, undefined, source);
		assert.ok(
			parsed.commands.some(({ unresolvedCwd }) => unresolvedCwd),
			source,
		);
	}
});

test("a dynamic executable is retained so it cannot hide an earlier denial", () => {
	const parsed = readShell("git commit --no-verify -m x; $cmd");
	assert.equal(parsed.commands.length, 2);
	assert.equal(parsed.commands[1].tokens[0].dynamic, true);
});

test("missing parser and syntax errors have distinct recovery facts", () => {
	const missing = readShell("git status", {
		parserPath: "/nonexistent/pfdsl-shfmt",
	});
	assert.equal(missing.failure, "parser-missing");
	assert.equal(missing.commands, undefined);
	assert.equal(readShell("if then").failure, "syntax");
});

test("property 5: unsupported syntax cannot weaken an earlier prohibition into ask", () => {
	for (const source of [
		"git commit --no-verify -m x; repeat 2 echo x",
		"git commit --no-verify -m x; python <<'EOF'\nprint('x')\nEOF",
		"git commit --no-verify -m x; if then",
	]) {
		const decision = shellParseDecision(source, { supportsAsk: true });
		assert.equal(decision.decision, "deny", source);
		assert.equal(decision.recovery, "rewrite", source);
	}
	const parsed = readShell("git commit --no-verify -m x; repeat 2 echo x");
	assert.equal(parsed.failure, "syntax");
	assert.ok(
		parsed.commands?.some(({ tokens }) =>
			tokens.some(({ value }) => value === "--no-verify"),
		),
	);
});
