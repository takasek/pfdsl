import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDelegationGuard } from "./delegation-guard.mjs";
import { runMainCommitGuard } from "./main-commit-guard.mjs";
import { readShell } from "./shell-commands.mjs";

const payload = (command) => ({
	tool_name: "Bash",
	cwd: "/fixture/topic",
	agent_id: "child",
	agent_type: "worker",
	tool_input: { command },
});
const child = (command) =>
	evaluateDelegationGuard(payload(command), { supportsAsk: false });
const main = (command) =>
	runMainCommitGuard(JSON.stringify(payload(command)), {
		supportsAsk: false,
		resolveBranches: () => ({
			currentBranch: "main",
			mainBranch: "main",
			targetRelation: "own",
		}),
	});

test("missing parser stops explicitly rather than returning an empty command list", () => {
	const result = readShell("echo hello", {
		parserPath: "/nonexistent/pfdsl-shfmt",
	});
	assert.match(result.error, /parser is missing.*make setup/);
	assert.equal(result.commands, undefined);
});

test("failed cd and pipeline cwd cannot authorize an own-tree mutation", () => {
	const decision = (command) =>
		runMainCommitGuard(
			JSON.stringify({
				tool_name: "Bash",
				cwd: "/fixture/main",
				tool_input: { command },
			}),
			{
				supportsAsk: false,
				resolveBranches: (_, cwd) => ({
					currentBranch: cwd === "/fixture/topic" ? "topic" : "main",
					mainBranch: "main",
					targetRelation: "own",
				}),
			},
		).output?.hookSpecificOutput.permissionDecision ?? "allow";
	assert.equal(decision("cd /fixture/topic && git add file"), "allow");
	assert.equal(decision("cd /fixture/topic; git add file"), "deny");
	assert.equal(decision("cd /fixture/topic | git add file"), "deny");
	assert.equal(decision("! cd /fixture/topic && git add file"), "deny");
	assert.equal(
		decision("! cd /fixture/topic > /nonexistent/output && git add file"),
		"deny",
	);
});

test("dynamic executable names behind known wrappers stop explicitly", () => {
	for (const command of [
		'command "$CMD" add file',
		'env "$CMD" add file',
		'exec "$CMD" add file',
		'nohup "$CMD" add file',
		'sudo -u user "$CMD" add file',
		'builtin "$CMD" add file',
		'builtin command "$CMD" add file',
	]) {
		assert.equal(child(command).decision, "deny", command);
		assert.match(child(command).reason, /literal command name/);
		assert.equal(
			main(command).output?.hookSpecificOutput.permissionDecision,
			"deny",
			command,
		);
	}
});

test("quoted substitutions are executable while case patterns are data", () => {
	for (const command of [
		'echo "$(git add file)"',
		"echo `git add file`",
		"cat <<EOF\n$(git add file)\nEOF",
		"'git' 'add' file",
		'g"i"t add file',
	]) {
		assert.equal(
			main(command).output?.hookSpecificOutput.permissionDecision,
			"deny",
			command,
		);
		assert.equal(child(command).decision, "deny", command);
	}
	for (const command of [
		"case gh in git) echo commit;; gh) echo merge;; esac",
		"case x in x|gh) :;; esac",
		"echo '$(git add file)'",
		"cat <<'EOF'\ngit add file\nEOF",
	]) {
		assert.equal(main(command).shouldOutput, false, command);
		assert.equal(child(command).decision, "allow", command);
	}
});

test("unsupported Zsh syntax stops with rewrite guidance", () => {
	for (const command of [
		"repeat 1 git status",
		"repeat 1 do git status; done",
		"{ :; } always { git status; }",
	]) {
		const result = child(command);
		assert.equal(result.decision, "deny", command);
		assert.match(result.reason, /unsupported|cannot parse/i);
		assert.match(result.reason, /rewrite/i);
		assert.equal(
			main(command).output?.hookSpecificOutput.permissionDecision,
			"deny",
			command,
		);
	}
});
