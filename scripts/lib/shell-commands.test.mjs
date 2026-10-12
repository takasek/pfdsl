import assert from "node:assert/strict";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	POLICY_DEADLINE_MS,
	SHELL_PARSER_TIMEOUT_MS,
} from "./agent-operation-timeouts.mjs";
import { readShell, shellParseDecision } from "./shell-commands.mjs";

test("internal parser and policy deadlines fit both configured hook timeouts", () => {
	assert.equal(SHELL_PARSER_TIMEOUT_MS, 3000);
	assert.equal(POLICY_DEADLINE_MS, 8000);
	assert.ok(SHELL_PARSER_TIMEOUT_MS < POLICY_DEADLINE_MS);
	for (const path of [".claude/settings.json", ".codex/hooks.json"]) {
		const config = JSON.parse(
			readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
		);
		const entries = config.hooks.PreToolUse.flatMap(
			({ hooks }) => hooks,
		).filter(({ command }) => command.includes("agent-operation-guard.mjs"));
		assert.ok(entries.length > 0);
		for (const { timeout } of entries) {
			assert.equal(timeout, 10);
			assert.ok(POLICY_DEADLINE_MS < timeout * 1000);
		}
	}
});

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
		"cd - && git add a",
		"cd /fixture/own && git status & git add a",
		"! cd /fixture/own && git add a",
		"cd /fixture/own && true; git add a",
	]) {
		const parsed = readShell(source);
		assert.equal(parsed.error, undefined, source);
		assert.ok(
			parsed.commands.some(
				({ tokens, unresolvedCwd }) =>
					tokens.some(({ value }) => value === "git") && unresolvedCwd,
			),
			source,
		);
	}
});

test("a dynamic executable is retained so it cannot hide an earlier denial", () => {
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
