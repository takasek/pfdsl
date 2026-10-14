import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { findProcessIdForIssueNumber } from "./cycle-status.mjs";
import { runCycleStatus } from "./cycle-status-steps.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = `${root}packages/cli/dist/cli.js`;
const roadmap = `---
type: roadmap
artifact:
  seed: { status: done }
  gui_mac_acceptance: { status: todo }
  gui_vscode_candidate: { status: todo }
  gui_vscode_acceptance: { status: todo }
  standalone_release: { status: todo }
  node_definition_creation: { status: done }
  preview_editing_usability: { status: wip }
  standalone_pfd_features: { status: wip }
process:
  i42_i43_accept_mac:
    location: https://github.com/example/project/issues/42
  i42_prepare_vscode:
    location: https://github.com/example/project/issues/42
  i42_accept_vscode:
    location: https://github.com/example/project/issues/42
  i43_publish:
    location: https://github.com/example/project/issues/43
  i44_improve:
    location: https://github.com/example/project/issues/44
  i45_i46_i47_implement:
    location: https://github.com/example/project/issues/45
---
seed >> i42_i43_accept_mac -> gui_mac_acceptance
seed >> i42_prepare_vscode -> gui_vscode_candidate
gui_vscode_candidate >> i42_accept_vscode -> gui_vscode_acceptance
gui_mac_acceptance >> i43_publish -> standalone_release
seed >> i44_improve -> [node_definition_creation, preview_editing_usability]
seed >> i45_i46_i47_implement -> standalone_pfd_features
`;

function deps(issueNumbers, artifact, source = roadmap) {
	return {
		root,
		base: "main",
		issueNumbers,
		artifact,
		existsSync,
		readFileSync: () => source,
		shTry: () => ({ ok: true, out: "", status: 0 }),
		sh: (_file, args) => {
			if (args.includes("neighbors")) {
				return execFileSync(
					process.execPath,
					args.map((arg) => (arg === ".pfdsl/roadmap.pfdsl" ? "-" : arg)),
					{
						cwd: root,
						encoding: "utf8",
						input: source,
					},
				);
			}
			if (args.includes(cli)) return JSON.stringify({ ok: true, ready: [] });
			return "";
		},
		githubOps: {
			listOpenPrs: async () => [],
			viewIssue: async () => ({
				body: "Implementation contract",
				comments: [],
				labels: [{ name: "flow:managed" }],
			}),
			repository: () => ({
				host: "github.com",
				owner: "example",
				repo: "project",
			}),
		},
	};
}

describe("cycle-status artifact selection using the actual graph reader", () => {
	for (const [issues, artifact] of [
		[[42], "gui_mac_acceptance"],
		[[42], "gui_vscode_candidate"],
		[[42], "gui_vscode_acceptance"],
		[[43], "gui_mac_acceptance"],
		[[43], "standalone_release"],
		[[43, 42], "gui_mac_acceptance"],
		[[44], "preview_editing_usability"],
		[[45, 46, 47], "standalone_pfd_features"],
	]) {
		it(`selects ${artifact} for ${issues.join(", ")}`, async () => {
			const result = await runCycleStatus(deps(issues, artifact));
			assert.equal(result.gateCheckCommandError, undefined);
			assert.match(
				result.gateCheckCommand,
				new RegExp(`--artifact ${artifact}(?: |$)`),
			);
			assert.match(
				result.wipUpdateCommand,
				new RegExp(` ${artifact} status wip$`),
			);
		});
	}

	for (const issue of [42, 43, 44]) {
		it(`does not generate commands for ambiguous issue ${issue}`, async () => {
			const result = await runCycleStatus(deps([issue]));
			assert.equal(result.gateCheckCommand, null);
			assert.equal(result.wipUpdateCommand, undefined);
			assert.match(result.gateCheckCommandError, /--artifact/);
		});
	}

	for (const [issues, artifact] of [
		[[42], "missing_artifact"],
		[[45], "gui_mac_acceptance"],
		[[43, 44], "gui_mac_acceptance"],
	]) {
		it(`rejects ${artifact} when it does not cover ${issues.join(", ")}`, async () => {
			const result = await runCycleStatus(deps(issues, artifact));
			assert.equal(result.gateCheckCommand, null);
			assert.equal(result.wipUpdateCommand, undefined);
			assert.match(result.gateCheckCommandError, /artifact|Artifact/);
		});
	}

	it("does not depend on process declaration order", async () => {
		const reversed = roadmap.replace(
			/^process:\n([\s\S]*?)(?=^\S)/m,
			(_match, section) =>
				`process:\n${section
					.split(/(?=^ {2}\S+:)/m)
					.filter((block) => block.trim())
					.reverse()
					.join("")}`,
		);
		for (const [issue, artifact] of [
			[42, "gui_vscode_acceptance"],
			[43, "standalone_release"],
		]) {
			const a = await runCycleStatus(deps([issue], artifact));
			const b = await runCycleStatus(deps([issue], artifact, reversed));
			assert.equal(a.gateCheckCommand, b.gateCheckCommand);
			assert.equal(a.wipUpdateCommand, b.wipUpdateCommand);
		}
	});

	it("does not generate commands when one mapped graph read fails", async () => {
		const input = deps([42], "gui_mac_acceptance");
		const original = input.sh;
		input.sh = (file, args) => {
			if (
				args.includes("neighbors") &&
				args.some((arg) => arg.includes("vscode"))
			)
				throw new Error("graph read failed");
			return original(file, args);
		};
		const result = await runCycleStatus(input);
		assert.equal(result.gateCheckCommand, null);
		assert.equal(result.wipUpdateCommand, undefined);
		assert.match(result.gateCheckCommandError, /graph read failed/);
	});

	it("the singular resolver rejects multiple matches", () => {
		assert.throws(
			() => findProcessIdForIssueNumber(roadmap, 42),
			/ambiguous|multiple/i,
		);
	});

	it("does not use outputs from an unsuccessful graph response", async () => {
		const input = deps([42], "gui_mac_acceptance");
		const original = input.sh;
		input.sh = (file, args) =>
			args.includes("neighbors")
				? JSON.stringify({
						ok: false,
						successors: [{ id: "gui_mac_acceptance", kind: "primary" }],
					})
				: original(file, args);
		const result = await runCycleStatus(input);
		assert.equal(result.gateCheckCommand, null);
		assert.equal(result.wipUpdateCommand, undefined);
		assert.match(result.gateCheckCommandError, /invalid response/);
	});
});
