import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const policies = [
	"main-commit",
	"delegation",
	"verification-tree",
	"closes-create",
	"worktree-write",
	"generated-root-instructions",
	"roadmap-publish",
];
const source = new URL("./", import.meta.url);
const exportsByPolicy = {
	"main-commit": ["classifyTargetRepository", "runMainCommitGuard"],
	delegation: ["runDelegationGuard"],
	"verification-tree": ["runVerificationTreeGuard", "supportsPermissionAsk"],
	"closes-create": ["runClosesCreateGuard"],
	"worktree-write": ["evaluatePhysicalWrites", "normalizeFileOperations"],
	"generated-root-instructions": [
		"evaluateGeneratedRootInstructionsGuard",
		"mayTargetGeneratedRootInstructions",
	],
	"roadmap-publish": ["evaluateRoadmapPublishGuard"],
};
const policyModule = (policy) =>
	policy === "worktree-write" ? "file-operation-policy" : `${policy}-guard`;
for (const policy of policies)
	for (const failure of [
		"missing",
		"syntax",
		"exception",
		"runtime",
		"helper-missing",
		"helper-syntax",
	])
		test(`${policy} blocks ${failure} policy loading instead of reporting normal success`, () => {
			const root = mkdtempSync(join(tmpdir(), "pfdsl-1404-policy-"));
			try {
				mkdirSync(join(root, "lib"));
				cpSync(
					new URL(`${policy}-guard.mjs`, source),
					join(root, `${policy}-guard.mjs`),
				);
				for (const [path, text] of [
					[
						"lib/policy-supervisor.mjs",
						readFileSync(new URL("lib/policy-supervisor.mjs", source)),
					],
					["lib/hook-io.mjs", readFileSync(new URL("lib/hook-io.mjs", source))],
					[
						"lib/guard-probe.mjs",
						readFileSync(new URL("lib/guard-probe.mjs", source)),
					],
					[
						"lib/file-operation-policy.mjs",
						"export const normalizeFileOperations = (p) => p.tool_name === 'Bash' ? [{tool_name:'Write',tool_input:{file_path:'/fixture/AGENTS.md'}}] : []; export const evaluatePhysicalWrites = () => ({decision:'allow'});\n",
					],
					[
						"lib/run-exec.mjs",
						"export const resolveGitRoots = () => null; export const tryGit = () => ({ok:false}); export const hasGitTargetEnvironment = () => false; export const withoutGitTargetEnvironment = () => ({});\n",
					],
					[
						"lib/native-worktree-owner.mjs",
						"export const refineNativeWorktreeRelation = (relation) => relation;\n",
					],
				])
					writeFileSync(join(root, path), text);
				if (failure === "missing" && policy === "worktree-write")
					rmSync(join(root, "lib/file-operation-policy.mjs"));
				if (failure !== "missing")
					writeFileSync(
						join(root, `lib/${policyModule(policy)}.mjs`),
						failure === "syntax"
							? "export {\n"
							: failure === "runtime" || failure.startsWith("helper-")
								? exportsByPolicy[policy]
										.map((name) =>
											failure.startsWith("helper-")
												? `export const ${name} = () => (${name === "normalizeFileOperations" ? "[]" : "{shouldOutput:false, decision:'allow'}"});`
												: `export const ${name} = () => { throw new Error('fixture-policy-runtime-error'); };`,
										)
										.join("\n")
								: "throw new Error('fixture-policy-load-error');\n",
					);
				if (failure === "helper-missing") rmSync(join(root, "lib/hook-io.mjs"));
				if (failure === "helper-syntax")
					writeFileSync(join(root, "lib/hook-io.mjs"), "export {\n");
				const result = spawnSync(
					process.execPath,
					[join(root, `${policy}-guard.mjs`)],
					{
						input: JSON.stringify({
							tool_name: "Bash",
							tool_input: { command: "git status" },
							cwd: root,
						}),
						encoding: "utf8",
					},
				);
				assert.equal(result.status, 2, result.stdout + result.stderr);
				assert.equal(
					JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
					"deny",
				);
				assert.match(result.stderr, /policy|guard/);
				if (failure === "exception")
					assert.match(result.stderr, /fixture-policy-load-error/);
				if (failure === "runtime")
					assert.match(result.stderr, /fixture-policy-runtime-error/);
				if (failure.startsWith("helper-")) {
					assert.match(
						result.stderr,
						failure === "helper-missing"
							? /Cannot find module.*hook-io\.mjs/
							: /Unexpected end of input/,
					);
					cpSync(
						new URL("lib/hook-io.mjs", source),
						join(root, "lib/hook-io.mjs"),
					);
					const repaired = spawnSync(
						process.execPath,
						[join(root, `${policy}-guard.mjs`)],
						{
							input: JSON.stringify({
								tool_name: "Read",
								tool_input: { file_path: "/fixture/source" },
							}),
							encoding: "utf8",
						},
					);
					assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
					assert.equal(repaired.stdout, "");
				}
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

for (const policy of policies)
	test(`${policy} preserves the normal read-only entrypoint path`, () => {
		const result = spawnSync(
			process.execPath,
			[new URL(`${policy}-guard.mjs`, source).pathname],
			{
				input: JSON.stringify({
					tool_name: "Bash",
					tool_input: { command: "git status" },
					cwd: process.cwd(),
				}),
				encoding: "utf8",
			},
		);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.equal(result.stdout, "");
	});

for (const tool of ["Edit", "Write"])
	for (const [policy, file, decision] of [
		["worktree-write", "scripts/source.mjs", "allow"],
		["worktree-write", "primary/source.mjs", "deny"],
		["generated-root-instructions", "scripts/source.mjs", "allow"],
		["generated-root-instructions", "AGENTS.md", "deny"],
		["roadmap-publish", "scripts/source.mjs", "allow"],
	])
		test(`${policy} preserves ${tool} ${decision} for ${file}`, () => {
			const primary = realpathSync(
				mkdtempSync(join(tmpdir(), "pfdsl-1404-normal-")),
			);
			let root = primary;
			try {
				const init = spawnSync("git", ["init", "-q", root], {
					encoding: "utf8",
				});
				assert.equal(init.status, 0, init.stderr);
				if (policy === "worktree-write") {
					const commit = spawnSync(
						"git",
						[
							"-C",
							primary,
							"-c",
							"user.name=Fixture",
							"-c",
							"user.email=fixture@example.test",
							"commit",
							"--allow-empty",
							"-qm",
							"fixture",
						],
						{ encoding: "utf8" },
					);
					assert.equal(commit.status, 0, commit.stderr);
					root = join(primary, "linked");
					const linked = spawnSync(
						"git",
						["-C", primary, "worktree", "add", "--detach", root],
						{ encoding: "utf8" },
					);
					assert.equal(linked.status, 0, linked.stderr);
					const metadata = spawnSync(
						"git",
						["-C", root, "rev-parse", "--git-path", "codex-thread.json"],
						{ encoding: "utf8" },
					);
					assert.equal(metadata.status, 0, metadata.stderr);
					writeFileSync(
						resolve(root, metadata.stdout.trim()),
						JSON.stringify({ version: 1, ownerThreadId: "fixture-session" }),
					);
				}
				const result = spawnSync(
					process.execPath,
					[new URL(`${policy}-guard.mjs`, source).pathname],
					{
						input: JSON.stringify({
							tool_name: tool,
							session_id: "fixture-session",
							tool_input: {
								file_path:
									policy === "worktree-write" && decision === "deny"
										? join(primary, "source.mjs")
										: join(root, file),
								content: "source",
							},
							cwd: root,
						}),
						encoding: "utf8",
					},
				);
				assert.equal(result.status, 0, result.stdout + result.stderr);
				if (decision === "allow") assert.equal(result.stdout, "");
				else
					assert.equal(
						JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
						"deny",
					);
			} finally {
				rmSync(primary, { recursive: true, force: true });
			}
		});
