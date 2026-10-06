// Integration coverage for audit-issues-flow.mjs's gh-unavailable exit.
// The GitHub-dependent checks are skipped (exit code 2) when the gh binary is
// missing and no token is set; the message is what an adopting repo reads to
// recover, so it must name both supported routes: an authenticated gh, or a
// GH_TOKEN/GITHUB_TOKEN for gh-less environments such as Claude Code Remote.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { GH_UNAVAILABLE_EXIT_CODE } from "./lib/gh-compat.mjs";
import { FLOW_LABELS } from "./lib/issues-flow-audit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "audit-issues-flow.mjs");

let emptyBin;

beforeEach(() => {
	emptyBin = mkdtempSync(join(tmpdir(), "audit-issues-flow-test-"));
});

afterEach(() => {
	rmSync(emptyBin, { recursive: true, force: true });
});

describe("audit-issues-flow without gh", () => {
	it("does not require mutable timestamp snapshots or emit repair commands", () => {
		// Run the real entry point against a disposable repository, independent
		// of completed-chain sweeps or other changes to the live roadmap.
		const fixtureRoot = join(emptyBin, "repo");
		const fixtureScripts = join(fixtureRoot, "scripts/pfdsl");
		mkdirSync(fixtureScripts, { recursive: true });
		mkdirSync(join(fixtureRoot, ".pfdsl"));
		const fixtureScript = join(fixtureScripts, "audit-issues-flow.mjs");
		copyFileSync(scriptPath, fixtureScript);
		symlinkSync(join(__dirname, "lib"), join(fixtureScripts, "lib"), "dir");
		const roadmap = join(fixtureRoot, ".pfdsl/roadmap.pfdsl");
		writeFileSync(
			roadmap,
			`---
artifact:
  input:
    status: done
  output:
    status: todo
process:
  i1_build_output:
    updated_at: 2020-01-01T00:00:00Z
---
input >> i1_build_output -> output
`,
		);
		const before = readFileSync(roadmap, "utf8");
		writeFileSync(
			join(emptyBin, "gh"),
			`#!${process.execPath}
const args = process.argv.slice(2);
const result = args[0] === "label"
  ? [{ name: "flow:managed", description: "tracked in .pfdsl/roadmap.pfdsl" }, { name: "flow:exempt", description: "intentionally out of .pfdsl/roadmap.pfdsl scope" }]
  : [{ number: 1, state: "OPEN", labels: [{ name: "flow:managed" }], updatedAt: "2099-10-03T12:00:00Z" }];
process.stdout.write(JSON.stringify(result));
`,
			{ mode: 0o755 },
		);
		const result = spawnSync(process.execPath, [fixtureScript], {
			encoding: "utf8",
			cwd: fixtureRoot,
			env: { ...process.env, PATH: `${emptyBin}:${process.env.PATH}` },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.doesNotMatch(result.stdout, /unknown_issue|missing_process/);
		assert.doesNotMatch(result.stdout, /stale_updated_at|repair|meta set/);
		assert.equal(readFileSync(roadmap, "utf8"), before);
	});

	it("skips with exit code 2 and names both gh and the token as ways to recover", () => {
		const env = { ...process.env, PATH: emptyBin };
		delete env.GH_TOKEN;
		delete env.GITHUB_TOKEN;
		const result = spawnSync(process.execPath, [scriptPath], {
			encoding: "utf-8",
			env,
		});
		assert.equal(result.status, GH_UNAVAILABLE_EXIT_CODE, result.stderr);
		assert.match(result.stdout, /skipping GitHub-dependent checks/);
		assert.match(result.stdout, /install and authenticate the gh CLI/);
		assert.match(result.stdout, /set GH_TOKEN or GITHUB_TOKEN/);
	});

	// With a token set, the HTTP route resolves owner/repo from the git remote.
	// If git itself is missing, that is not "gh unavailable": telling the reader
	// to set the token they already set would not help them recover.
	it("reports a git remote failure instead of skipping when a token is set", () => {
		const env = { ...process.env, PATH: emptyBin, GH_TOKEN: "dummy" };
		delete env.GITHUB_TOKEN;
		const result = spawnSync(process.execPath, [scriptPath], {
			encoding: "utf-8",
			env,
		});
		assert.notEqual(result.status, GH_UNAVAILABLE_EXIT_CODE, result.stdout);
		assert.notEqual(result.status, 0);
		assert.doesNotMatch(result.stdout, /gh unavailable/);
		assert.match(result.stderr, /could not read the git remote/);
	});
});

// Label findings must not hide the issue-level sync findings behind them.
// The audit runs from a copy of the script in a scratch tree with a one-process
// roadmap and a fake `gh`, so both the label list and the issue list are fixed.
describe("audit-issues-flow label findings", () => {
	const [managed, exempt] = FLOW_LABELS;
	const updatedAt = "2026-10-01T00:00:00Z";
	let tree;

	beforeEach(() => {
		tree = mkdtempSync(join(tmpdir(), "audit-issues-flow-labels-"));
		mkdirSync(join(tree, "scripts/pfdsl"), { recursive: true });
		copyFileSync(scriptPath, join(tree, "scripts/pfdsl/audit-issues-flow.mjs"));
		symlinkSync(join(__dirname, "lib"), join(tree, "scripts/pfdsl/lib"), "dir");
		symlinkSync(
			resolve(__dirname, "../../node_modules"),
			join(tree, "node_modules"),
		);
		mkdirSync(join(tree, ".pfdsl"));
		writeFileSync(
			join(tree, ".pfdsl/roadmap.pfdsl"),
			`---\ntype: roadmap\nartifact:\n  out: { status: todo }\nprocess:\n  i5_do_it: { label: Do it, updated_at: "${updatedAt}" }\n---\n>> i5_do_it -> out\n`,
		);
		mkdirSync(join(tree, "bin"));
		const gh = join(tree, "bin/gh");
		writeFileSync(
			gh,
			`#!/bin/sh
case "$1 $2" in
  "label list") printf '%s' "$FAKE_LABELS" ;;
  "issue list") printf '%s' "$FAKE_ISSUES" ;;
  *) echo "unexpected gh $*" >&2; exit 64 ;;
esac
`,
			{ mode: 0o755 },
		);
	});

	afterEach(() => {
		rmSync(tree, { recursive: true, force: true });
	});

	function audit(labels, issueLabels, args = []) {
		const env = {
			...process.env,
			PATH: `${join(tree, "bin")}:${process.env.PATH}`,
			FAKE_LABELS: JSON.stringify(labels),
			FAKE_ISSUES: JSON.stringify([
				{
					number: 5,
					state: "OPEN",
					stateReason: null,
					labels: issueLabels.map((name) => ({ name })),
					updatedAt,
				},
			]),
		};
		delete env.GH_TOKEN;
		delete env.GITHUB_TOKEN;
		return spawnSync(
			process.execPath,
			[join(tree, "scripts/pfdsl/audit-issues-flow.mjs"), ...args],
			{ encoding: "utf-8", env },
		);
	}

	const matching = [managed, exempt];
	const staleManaged = [{ ...managed, description: "old" }, exempt];

	it("passes when only a description differs and the issues are in sync", () => {
		const result = audit(staleManaged, ["flow:managed"]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /label_description_mismatch \[flow:managed\]/);
		assert.match(result.stdout, /label advisory \(does not fail this audit\)/);
		assert.match(result.stdout, /roadmap\.pfdsl is in sync/);
	});

	it("still reports issue findings when a description differs, and fails on them", () => {
		const result = audit(staleManaged, []);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /label_description_mismatch \[flow:managed\]/);
		assert.match(result.stdout, /#5 missing_label/);
	});

	it("fails on a missing label and still reports issue findings", () => {
		const result = audit([managed], []);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /label_missing \[flow:exempt\]/);
		assert.match(result.stdout, /#5 missing_label/);
	});

	it("fails on a missing label even when the issues are in sync", () => {
		const result = audit([managed], ["flow:managed"]);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /label_missing \[flow:exempt\]/);
		assert.doesNotMatch(result.stdout, /roadmap\.pfdsl is in sync/);
	});

	// --enforce-issue scopes which issues block; it does not scope the label
	// check, which no issue owns.
	it("fails on a missing label under --enforce-issue, while another issue's finding only advises", () => {
		const result = audit([managed], [], ["--enforce-issue", "9"]);
		assert.equal(result.status, 1, result.stdout + result.stderr);
		assert.match(result.stdout, /^label:\n {2}label_missing \[flow:exempt\]/m);
		assert.match(
			result.stdout,
			/advisory \(does not fail this audit\):\n {2}#5 missing_label/,
		);
		assert.doesNotMatch(result.stdout, /^blocking:/m);
	});

	it("passes with matching labels and in-sync issues", () => {
		const result = audit(matching, ["flow:managed"]);
		assert.equal(result.status, 0, result.stdout + result.stderr);
		assert.match(result.stdout, /roadmap\.pfdsl is in sync/);
		assert.doesNotMatch(result.stdout, /label/);
	});
});
