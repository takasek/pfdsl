import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	formatStaleWarning,
	runStaleDistGuard,
	stalePackages,
	trustsBuildOutput,
} from "./stale-dist-guard.mjs";

describe("trustsBuildOutput", () => {
	it.each = undefined; // node:test has no it.each; the loops below stand in

	for (const command of [
		"pnpm -r typecheck",
		"pnpm --filter @pfdsl/core typecheck",
		"tsgo --noEmit",
		"pnpm -r test",
		"pnpm --filter @pfdsl/cli exec vitest run",
		"npm test",
		'node --test "scripts/lib/*.test.mjs"',
	]) {
		it(`flags ${command}`, () => {
			assert.equal(trustsBuildOutput(command), true);
		});
	}

	// A command that builds first is about to make dist/ current, so warning
	// about staleness would be noise at exactly the moment it is being fixed.
	for (const command of [
		"pnpm -r build",
		"pnpm -r build && pnpm -r typecheck",
		"pnpm -r build > /dev/null 2>&1; pnpm -r test",
	]) {
		it(`stays quiet for ${command}`, () => {
			assert.equal(trustsBuildOutput(command), false);
		});
	}

	for (const command of [
		"git status --short",
		"gh pr list",
		"node scripts/gate-check.mjs --no-artifact",
		"grep -rn 'test' packages/",
	]) {
		it(`ignores ${command}`, () => {
			assert.equal(trustsBuildOutput(command), false);
		});
	}

	it("ignores a non-string command, since the payload is not ours to trust", () => {
		assert.equal(trustsBuildOutput(undefined), false);
		assert.equal(trustsBuildOutput(42), false);
	});

	it("does not fire on a path that merely contains the word test", () => {
		assert.equal(
			trustsBuildOutput("cat packages/cli/src/index.test.ts"),
			false,
		);
	});
});

describe("stalePackages", () => {
	const packages = [
		{ name: "@pfdsl/core", distFile: "packages/core/dist/index.js" },
		{ name: "@pfdsl/cli", distFile: "packages/cli/dist/cli.js" },
	];

	it("returns nothing when every build is current", () => {
		assert.deepEqual(
			stalePackages(packages, () => false),
			[],
		);
	});

	it("names only the stale ones", () => {
		const stale = stalePackages(packages, (f) => f.includes("core"));
		assert.deepEqual(stale, ["@pfdsl/core"]);
	});

	it("preserves the order it was given, so output is stable across runs", () => {
		assert.deepEqual(
			stalePackages(packages, () => true),
			["@pfdsl/core", "@pfdsl/cli"],
		);
	});
});

describe("formatStaleWarning", () => {
	it("is undefined when nothing is stale, so the hook prints nothing", () => {
		assert.equal(formatStaleWarning([]), undefined);
	});

	it("names the package and says what it costs", () => {
		const text = formatStaleWarning(["@pfdsl/core"]);
		assert.match(text, /@pfdsl\/core has a build older than its sources/);
		assert.match(text, /fail in CI/);
		assert.match(text, /pnpm -r build/);
	});

	it("agrees with itself in number for several packages", () => {
		assert.match(
			formatStaleWarning(["a", "b"]),
			/a, b have builds older than their sources/,
		);
	});
});

describe("runStaleDistGuard", () => {
	const staleInput = (event) =>
		JSON.stringify({
			hook_event_name: event,
			tool_name: "Bash",
			tool_input: { command: "pnpm -r typecheck" },
		});

	it("hands the warning to the model as additionalContext after the command ran", () => {
		const { shouldOutput, output } = runStaleDistGuard(
			staleInput("PostToolUse"),
			{
				findStale: () => ["@pfdsl/core"],
			},
		);
		assert.equal(shouldOutput, true);
		assert.equal(output.hookSpecificOutput.hookEventName, "PostToolUse");
		assert.match(output.hookSpecificOutput.additionalContext, /@pfdsl\/core/);
	});

	it("writes to stderr before the command runs, where the model cannot be reached", () => {
		const result = runStaleDistGuard(staleInput("PreToolUse"), {
			findStale: () => ["@pfdsl/core"],
		});
		assert.equal(result.shouldOutput, false);
		assert.match(result.stderr, /@pfdsl\/core/);
	});

	it("says nothing when nothing is stale", () => {
		assert.deepEqual(
			runStaleDistGuard(staleInput("PostToolUse"), { findStale: () => [] }),
			{
				shouldOutput: false,
			},
		);
	});

	it("does not go near the filesystem for a command that does not read the build", () => {
		let called = false;
		const input = JSON.stringify({
			hook_event_name: "PreToolUse",
			tool_name: "Bash",
			tool_input: { command: "git status" },
		});
		const result = runStaleDistGuard(input, {
			findStale: () => {
				called = true;
				return ["@pfdsl/core"];
			},
		});
		assert.equal(result.shouldOutput, false);
		assert.equal(called, false);
	});

	it("silently allows malformed stdin JSON", () => {
		assert.deepEqual(
			runStaleDistGuard("not json{{{", { findStale: () => ["@pfdsl/core"] }),
			{
				shouldOutput: false,
			},
		);
	});
});
