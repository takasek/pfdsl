import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
	findVerificationSegments,
	runVerificationTreeGuard,
	supportsPermissionAsk,
} from "./verification-tree-guard.mjs";

const MAIN = "/repo";
const FEATURE = "/worktrees/feature";
function run(
	command,
	{
		cwd = MAIN,
		supportsAsk = false,
		resolveRoots = (target) => ({
			worktreeRoot: target,
			mainRoot: MAIN,
			hasLinkedWorktrees: true,
		}),
		...options
	} = {},
) {
	return runVerificationTreeGuard(
		JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
		{
			resolveRoots,
			supportsAsk,
			payloadCwdIsExecutionCwd: supportsAsk,
			...options,
		},
	);
}
function decision(result) {
	return result.output?.hookSpecificOutput.permissionDecision ?? "allow";
}

describe("verification command boundaries", () => {
	for (const command of [
		"make",
		"make format",
		"make test",
		"make -C /repo test",
		"make --directory=/repo test",
		"pnpm --dir /repo test",
		"pnpm -r build",
		"pnpm install",
		"npm --prefix /repo test",
		"npm run build",
		"npx biome check",
		"node scripts/check.mjs",
		'node "scripts/check.mjs"',
		"node check.js",
		"node some/entrypoint",
		"node /repo/scripts/check.mjs",
		"node --test",
		"node --test /repo/scripts/check.test.mjs",
	])
		it(`classifies ${command}`, () =>
			assert.deepEqual(findVerificationSegments(command), [command]));

	for (const command of [
		"git status",
		"ls",
		"node --version",
		"node -v",
		"node",
		"node -e '1+1'",
		"node --input-type=module -e 'console.log(1)'",
		"node --eval='1+1'",
		"node -p '1+1'",
		"node -e '1+1' /repo/script.mjs",
	])
		it(`leaves the supported non-verification boundary: ${command}`, () =>
			assert.deepEqual(findVerificationSegments(command), []));

	it("does not mistake script arguments for Node eval flags", () => {
		assert.deepEqual(
			findVerificationSegments("node scripts/check.mjs --eval example"),
			["node scripts/check.mjs --eval example"],
		);
	});
	it("handles malformed/unrelated payloads without Git reads", () => {
		const options = {
			resolveRoots: () => {
				throw Error("unexpected Git read");
			},
			supportsAsk: false,
			payloadCwdIsExecutionCwd: false,
		};
		for (const input of [
			"not-json",
			JSON.stringify({
				tool_name: "Read",
				tool_input: { command: "make test" },
			}),
			JSON.stringify({ tool_name: "Bash" }),
		])
			assert.deepEqual(runVerificationTreeGuard(input, options), {
				shouldOutput: false,
			});
		assert.deepEqual(findVerificationSegments(undefined), []);
	});
});

describe("effective verification cwd", () => {
	it("uses explicit effective cwd for Codex verification", () => {
		for (const command of [
			`cd ${FEATURE} && node scripts/check.mjs`,
			`cd ${FEATURE} && node --test ${FEATURE}/scripts/check.test.mjs`,
			`make -C ${FEATURE} test`,
			`make --directory=${FEATURE} test`,
			`make -C${FEATURE} test`,
			`pnpm --dir ${FEATURE} test`,
			`npm --prefix ${FEATURE} test`,
			`env -C ${FEATURE} node scripts/check.mjs`,
			`cd ${MAIN} && make test`,
			`make -C ${MAIN} test`,
			`cd ${FEATURE} && node scripts/check-md-linebreaks.mjs scripts/lib/example.mjs`,
		])
			assert.equal(decision(run(command)), "allow", command);
	});
	it("does not treat invisible Codex workdir or an absolute script as cwd proof", () => {
		for (const cwd of [MAIN, FEATURE])
			for (const command of [
				"node scripts/check.mjs",
				`node ${FEATURE}/scripts/check.mjs`,
				`node --test ${FEATURE}/scripts/check.test.mjs`,
				"make -C . test",
				"pnpm --dir ../feature test",
				"npm --prefix . test",
				"make -C test",
				"make -C",
				"pnpm --dir= test",
				`make -C ${FEATURE} test && node scripts/check.mjs`,
				`env -C ${FEATURE} make test && node scripts/check.mjs`,
			]) {
				const result = run(command, { cwd });
				assert.equal(decision(result), "deny", command);
				assert.match(
					result.output.hookSpecificOutput.permissionDecisionReason,
					/absolute/i,
				);
				assert.doesNotMatch(
					result.output.hookSpecificOutput.permissionDecisionReason,
					/retry.*workdir|reopen/i,
				);
			}
	});
	it("does not mistake an option's value or forwarded script arguments for cwd options", () => {
		for (const command of [
			"make -f -C /feature test",
			"npm --userconfig --prefix /feature test",
			"pnpm test -- --dir /feature",
			"npm run test -- --prefix /feature",
		])
			assert.equal(decision(run(command)), "deny", command);
	});
	it("resolves relative options only from a known base, including repeated make -C", () => {
		for (const command of [
			"cd /feature && make -C . test",
			"make -C /worktrees -C feature test",
			"cd /worktrees && pnpm --dir feature test",
			"cd /worktrees && npm --prefix feature test",
		])
			assert.equal(decision(run(command)), "allow", command);
	});
	it("resolves the last npm and pnpm cwd option against the original process cwd", () => {
		for (const command of [
			"npm --prefix /feature --prefix . root",
			"pnpm --dir /feature --dir . root",
		])
			assert.equal(decision(run(command)), "deny", command);
		for (const command of [
			"npm --prefix . --prefix /feature root",
			"pnpm --dir . --dir /feature root",
		])
			assert.equal(decision(run(command)), "allow", command);
	});
	it("inspects every segment, preserving later uncertainty", () => {
		for (const command of [
			"make -C /feature test && make test",
			"cd /feature && node check.mjs && cd $UNKNOWN && make test",
			"cd /feature && make test; node check.mjs",
		])
			assert.equal(decision(run(command)), "deny", command);
		assert.equal(
			decision(run("cd /feature && make test && cd /repo && node check.mjs")),
			"allow",
		);
	});
	it("fails closed for unknown control flow, prefixes, and protected environment", () => {
		for (const command of [
			"if true; then make -C /feature test; fi",
			"(cd /feature && make test)",
			"cd /feature || make test",
			"pushd /feature && make test",
			'cd "$FEATURE" && make test',
			"sudo --unknown value make -C /feature test",
			"GIT_DIR=/repo/.git make -C /feature test",
			"export GIT_WORK_TREE=/repo; make -C /feature test",
			"CDPATH=/root cd feature && node check.mjs",
		])
			assert.equal(decision(run(command)), "deny", command);
		assert.equal(
			decision(
				run("make -C /feature test", { ambientGitTargetOverride: true }),
			),
			"deny",
		);
		assert.equal(
			decision(
				run("cd feature && make test", {
					supportsAsk: true,
					ambientCdPath: true,
				}),
			),
			"deny",
		);
	});
	it("uses Claude's actual initial cwd and asks only for implicit main drift", () => {
		assert.equal(
			decision(run("make test", { supportsAsk: true, cwd: FEATURE })),
			"allow",
		);
		assert.equal(decision(run("make test", { supportsAsk: true })), "ask");
		assert.equal(
			decision(run("node /feature/check.mjs", { supportsAsk: true })),
			"ask",
		);
		assert.equal(
			decision(run("cd /feature && make test", { supportsAsk: true })),
			"allow",
		);
		assert.equal(
			decision(
				run("cd /repo && make test", { supportsAsk: true, cwd: FEATURE }),
			),
			"allow",
		);
	});
	it("preserves known implicit cwd outside Git or without linked worktrees", () => {
		assert.equal(
			decision(
				run("make test", { supportsAsk: true, resolveRoots: () => null }),
			),
			"allow",
		);
		assert.equal(
			decision(
				run("make test", {
					supportsAsk: true,
					resolveRoots: () => ({
						worktreeRoot: MAIN,
						mainRoot: MAIN,
						hasLinkedWorktrees: false,
					}),
				}),
			),
			"allow",
		);
	});
	it("recognizes the existing Claude harness signal", () => {
		assert.equal(supportsPermissionAsk({}), false);
		assert.equal(supportsPermissionAsk({ CLAUDE_PROJECT_DIR: " \t " }), false);
		assert.equal(supportsPermissionAsk({ CLAUDE_PROJECT_DIR: MAIN }), true);
	});
});

describe("verification wrapper", () => {
	const script = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../verification-tree-guard.mjs",
	);
	let root, main, feature;
	function git(cwd, args) {
		return execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	}
	before(() => {
		root = realpathSync(
			mkdtempSync(join(tmpdir(), "verification-tree-guard-")),
		);
		main = join(root, "main");
		feature = join(root, "feature");
		mkdirSync(main);
		git(main, ["init", "-b", "main"]);
		git(main, [
			"-c",
			"user.name=Guard Test",
			"-c",
			"user.email=guard@example.invalid",
			"commit",
			"--allow-empty",
			"-m",
			"fixture",
		]);
		git(main, ["worktree", "add", "-b", "feature", feature]);
	});
	after(() => rmSync(root, { recursive: true, force: true }));
	function wrapper(command, cwd, claude) {
		const env = { ...process.env };
		delete env.CLAUDE_PROJECT_DIR;
		if (claude) env.CLAUDE_PROJECT_DIR = main;
		const out = execFileSync(process.execPath, [script], {
			env,
			encoding: "utf8",
			input: JSON.stringify({
				tool_name: "Bash",
				tool_input: { command },
				cwd,
			}),
		}).trim();
		return out === ""
			? "allow"
			: JSON.parse(out).hookSpecificOutput.permissionDecision;
	}
	it("keeps the original Claude project root separate from actual shell cwd", () => {
		assert.equal(wrapper("node check.mjs", feature, true), "allow");
		assert.equal(wrapper("node check.mjs", main, true), "ask");
		assert.equal(
			wrapper(`cd ${feature} && node check.mjs`, main, true),
			"allow",
		);
	});
	it("requires explicit cwd for Codex even when payload cwd names a feature worktree", () => {
		assert.equal(wrapper("node check.mjs", feature, false), "deny");
		assert.equal(wrapper(`node ${feature}/check.mjs`, feature, false), "deny");
		assert.equal(
			wrapper(`cd ${feature} && node check.mjs`, main, false),
			"allow",
		);
	});
});
