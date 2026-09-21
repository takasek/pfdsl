import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildGateCheckCommand,
	countBehind,
	findIssueNumberForProcess,
	findProcessIdForIssueNumber,
	isUnregisteredManagedIssue,
	parsePorcelainPaths,
	parseReadyOutput,
	summarizeReleasePending,
} from "./cycle-status.mjs";

describe("parseReadyOutput", () => {
	it("extracts ready ids, best id, and best outputs", () => {
		const json = {
			ok: true,
			ready: [
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
			],
			best: { id: "a", label: "A", outputs: ["a_out"] },
		};
		assert.deepEqual(parseReadyOutput(json), {
			ready: ["a", "b"],
			best: "a",
			bestOutputs: ["a_out"],
		});
	});

	it("returns empty when ok is false", () => {
		assert.deepEqual(parseReadyOutput({ ok: false }), {
			ready: [],
			best: null,
			bestOutputs: [],
		});
	});

	it("returns empty for missing/invalid input", () => {
		assert.deepEqual(parseReadyOutput(null), {
			ready: [],
			best: null,
			bestOutputs: [],
		});
		assert.deepEqual(parseReadyOutput(undefined), {
			ready: [],
			best: null,
			bestOutputs: [],
		});
	});

	it("returns null best and empty bestOutputs when absent", () => {
		const json = { ok: true, ready: [] };
		assert.deepEqual(parseReadyOutput(json), {
			ready: [],
			best: null,
			bestOutputs: [],
		});
	});
});

describe("findIssueNumberForProcess", () => {
	const pfdsl = `artifacts:
  spec_id_syntax:
    label: 仕様ID構文
processes:
  i402_implement_get_by_id:
    label: get-by-ID ツール実装
    location: https://github.com/takasek/pfdsl/issues/402
  i405_implement_mint_check:
    label: mint-check ツール実装
    location: https://github.com/takasek/pfdsl/issues/405
    updated_at: 2026-07-10T01:50:30Z
  i435_implement_ansi_color:
    label: 診断 ANSI カラー実装
    location: https://github.com/takasek/pfdsl/issues/435
`;

	it("extracts the issue number from the process block's location", () => {
		assert.equal(
			findIssueNumberForProcess(pfdsl, "i405_implement_mint_check"),
			405,
		);
	});

	it("does not bleed into a neighboring process's location", () => {
		assert.equal(
			findIssueNumberForProcess(pfdsl, "i402_implement_get_by_id"),
			402,
		);
	});

	it("returns null for an unknown process id", () => {
		assert.equal(findIssueNumberForProcess(pfdsl, "i999_nonexistent"), null);
	});
});

describe("findProcessIdForIssueNumber", () => {
	// The top-level key is the singular `process:`, matching the real
	// .pfdsl/roadmap.pfdsl (confirmed by reading the file directly — an earlier
	// version of this task's brief assumed a plural `processes:` key and a
	// per-process `outputs:` field, neither of which exists there).
	const pfdsl = `artifact:
  spec_id_syntax:
    label: 仕様ID構文
    location: https://github.com/takasek/pfdsl/issues/999
process:
  i402_implement_get_by_id:
    label: get-by-ID ツール実装
    location: https://github.com/takasek/pfdsl/issues/402
  i405_implement_mint_check:
    label: mint-check ツール実装
    location: https://github.com/takasek/pfdsl/issues/405
    updated_at: 2026-07-10T01:50:30Z
  i435_implement_ansi_color:
    label: 診断 ANSI カラー実装
    location: https://github.com/takasek/pfdsl/issues/435
tag:
  some_tag: {}
`;

	it("returns the processId whose location matches the issue number", () => {
		assert.equal(
			findProcessIdForIssueNumber(pfdsl, 405),
			"i405_implement_mint_check",
		);
	});

	it("does not bleed into a neighboring process's location", () => {
		assert.equal(
			findProcessIdForIssueNumber(pfdsl, 402),
			"i402_implement_get_by_id",
		);
	});

	it("resolves the last process entry in the section, proving the section boundary (before tag:) is handled", () => {
		assert.equal(
			findProcessIdForIssueNumber(pfdsl, 435),
			"i435_implement_ansi_color",
		);
	});

	it("does not match an issue number that only appears in the artifact section", () => {
		// issue 999 is only referenced from spec_id_syntax's location, in
		// artifact:, not process:. A naive scan across the whole file would wrongly
		// resolve this.
		assert.equal(findProcessIdForIssueNumber(pfdsl, 999), null);
	});

	it("returns null for an issue number with no matching process at all", () => {
		assert.equal(findProcessIdForIssueNumber(pfdsl, 1), null);
	});
});

describe("buildGateCheckCommand", () => {
	it("builds the completed gate-check command line", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main"),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool",
		);
	});

	it("appends --issue when the cycle's issue is known", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main", [669]),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool --issue 669",
		);
	});

	it("repeats --issue for every issue the cycle closes", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main", [667, 668]),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool --issue 667 --issue 668",
		);
	});

	it("omits --issue when no issue is known", () => {
		assert.equal(
			buildGateCheckCommand("mint_check_tool", "main", []),
			"node scripts/gate-check.mjs --base main --artifact mint_check_tool",
		);
	});

	it("builds the explicit no-artifact command when artifactKey is missing", () => {
		assert.equal(
			buildGateCheckCommand(null, "main", [969]),
			"node scripts/gate-check.mjs --base main --no-artifact --issue 969",
		);
	});
});

describe("countBehind", () => {
	it("counts non-empty lines", () => {
		assert.equal(countBehind("abc123 commit one\ndef456 commit two\n"), 2);
	});

	it("returns 0 for empty output", () => {
		assert.equal(countBehind(""), 0);
		assert.equal(countBehind("\n"), 0);
	});
});

describe("summarizeReleasePending", () => {
	it("reports needsAction when release-status exited non-zero", () => {
		const summary = summarizeReleasePending({
			ok: false,
			status: 1,
			out: "release-status:\n@pfdsl/cli 0.0.25 (37 commits ahead)\n",
		});
		assert.equal(summary.needsAction, true);
		assert.deepEqual(summary.report, [
			"release-status:",
			"@pfdsl/cli 0.0.25 (37 commits ahead)",
		]);
	});

	it("reports needsAction false when everything is published", () => {
		const summary = summarizeReleasePending({
			ok: true,
			status: 0,
			out: "release-status:\nall packages current\n",
		});
		assert.equal(summary.needsAction, false);
	});

	it("drops blank lines so the report carries only the material", () => {
		const summary = summarizeReleasePending({
			ok: true,
			status: 0,
			out: "\nrelease-status:\n\n  spec history: current  \n\n",
		});
		assert.deepEqual(summary.report, [
			"release-status:",
			"  spec history: current",
		]);
	});

	it("returns an empty report when the command produced no output", () => {
		assert.deepEqual(
			summarizeReleasePending({ ok: true, status: 0, out: "" }).report,
			[],
		);
	});
});

describe("parsePorcelainPaths", () => {
	it("returns the path of every entry, tracked or not", () => {
		assert.deepEqual(
			parsePorcelainPaths(
				" M scripts/gate-check.mjs\n?? notes.txt\nA  x.mjs\n",
			),
			["scripts/gate-check.mjs", "notes.txt", "x.mjs"],
		);
	});

	it("returns an empty list for a clean tree", () => {
		assert.deepEqual(parsePorcelainPaths(""), []);
		assert.deepEqual(parsePorcelainPaths("\n"), []);
	});

	// A rename is one entry naming two paths. The destination is where the
	// content sits now, so that is the path a reader has to deal with.
	it("takes the destination of a rename", () => {
		assert.deepEqual(parsePorcelainPaths("R  old.mjs -> new.mjs\n"), [
			"new.mjs",
		]);
	});

	// Porcelain v1 pads the status to two columns, so a path is never shorter
	// than its line minus three — but a path containing " -> " outside a rename
	// entry would be split by a naive replace.
	it("keeps a space-bearing path intact", () => {
		assert.deepEqual(parsePorcelainPaths("?? docs/a b.md\n"), ["docs/a b.md"]);
	});
});

describe("isUnregisteredManagedIssue", () => {
	it("reports a flow:managed issue with no process in the roadmap", () => {
		assert.equal(isUnregisteredManagedIssue(["flow:managed"], null), true);
	});

	it("stays quiet once the issue has a tracked process", () => {
		assert.equal(
			isUnregisteredManagedIssue(["flow:managed"], "i956_generate_codex"),
			false,
		);
	});

	it("stays quiet for flow:exempt issues, which are absent by design", () => {
		assert.equal(isUnregisteredManagedIssue(["flow:exempt"], null), false);
	});

	it("stays quiet for an unlabelled issue: triage is a different finding", () => {
		assert.equal(isUnregisteredManagedIssue([], null), false);
	});
});
