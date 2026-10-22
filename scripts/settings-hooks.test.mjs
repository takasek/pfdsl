// The wiring in .claude/settings.json, checked as data.
//
// A script wired to two events runs twice per tool call, spawning a second
// process and, unless it behaves differently per event, saying the same thing
// twice. Neither is worth paying for, so nothing should be wired twice. Which
// single event a given hook belongs on is decided where that hook lives —
// see buildAdvisoryOutput in lib/hook-io.mjs for the advisory case (#929).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every wired hook command, with the events it is wired to. */
function wiringByCommand() {
	const settings = JSON.parse(
		readFileSync(resolve(root, ".claude/settings.json"), "utf8"),
	);
	const wiring = new Map();
	for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
		for (const group of groups) {
			for (const hook of group.hooks ?? []) {
				const events = wiring.get(hook.command) ?? [];
				if (!events.includes(event)) events.push(event);
				wiring.set(hook.command, events);
			}
		}
	}
	return wiring;
}

describe(".claude/settings.json hook wiring", () => {
	it("allows bounded cloud setup and read-only GitHub tools without wildcard writes", () => {
		const settings = JSON.parse(
			readFileSync(resolve(root, ".claude/settings.json"), "utf8"),
		);
		const allow = settings.permissions.allow;
		for (const command of [
			"make setup",
			"make test",
			"make lint",
			"make typecheck",
			"git fetch origin *",
			"git merge --ff-only origin/*",
		])
			assert.ok(allow.includes(`Bash(${command})`), command);
		assert.equal(allow.includes("Bash(make *)"), false);
		assert.deepEqual(
			allow.filter((rule) => rule.startsWith("mcp__github__")).sort(),
			[
				"mcp__github__get_*",
				"mcp__github__issue_read",
				"mcp__github__list_*",
				"mcp__github__pull_request_read",
				"mcp__github__search_*",
			],
		);
	});
	it("wires the operation entry exactly once for Bash, files and GitHub MCP in both harnesses", () => {
		for (const file of [".claude/settings.json", ".codex/hooks.json"]) {
			const settings = JSON.parse(readFileSync(resolve(root, file), "utf8"));
			for (const tool of [
				"Bash",
				"Edit",
				"Write",
				"apply_patch",
				"mcp__github__merge_pull_request",
				"mcp__plugin_github_github__create_issue",
				"mcp__codex_apps__github_create_issue",
			]) {
				const matching = settings.hooks.PreToolUse.filter((group) =>
					new RegExp(`^(?:${group.matcher})$`).test(tool),
				).flatMap((group) => group.hooks);
				assert.equal(
					matching.filter(
						(hook) => hook.command === "node scripts/agent-operation-guard.mjs",
					).length,
					1,
					`${file}: ${tool}`,
				);
			}
			assert.equal(
				JSON.stringify(settings.hooks).includes("main-commit-guard"),
				false,
			);
		}
	});
	it("ships the managed issue reminder without inferring commits from commands", () => {
		const hooks = JSON.parse(
			readFileSync(resolve(root, "hooks/hooks.json"), "utf8"),
		);
		const commands = Object.values(hooks.hooks).flatMap((groups) =>
			groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
		);
		assert.equal(
			commands.some((command) =>
				command.includes("retro-reminder-post-tool-use"),
			),
			false,
		);
		assert.equal(
			commands.some((command) =>
				command.includes("managed-issue-reminder-post-tool-use"),
			),
			true,
		);
	});

	it("wires no command to more than one event", () => {
		const duplicates = [...wiringByCommand()]
			.filter(([, events]) => events.length > 1)
			.map(([command, events]) => `${command} -> ${events.join(", ")}`);
		assert.deepEqual(duplicates, []);
	});

	it("does not deliver case prescriptions after ordinary writes", () => {
		assert.equal(
			wiringByCommand().has("node scripts/pre-artifact-advisory.mjs"),
			false,
		);
	});

	it("leaves Markdown linebreak checks to pre-commit", () => {
		assert.equal(
			wiringByCommand().has("node scripts/md-write-check.mjs"),
			false,
		);
	});

	it("does not advise on companion prose after ordinary writes", () => {
		assert.equal(
			wiringByCommand().has("node scripts/companion-prose-advisory.mjs"),
			false,
		);
	});

	it("does not warn about a stale dist/ after the fact — the build dependency removed the case", () => {
		assert.equal(
			wiringByCommand().has("node scripts/stale-dist-guard.mjs"),
			false,
		);
	});
});
