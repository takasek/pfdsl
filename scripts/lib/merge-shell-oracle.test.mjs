import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	evaluateDelegationGuard,
	stripLeadingNoise,
} from "./delegation-guard.mjs";
import { findMergeCommand } from "./external-operation-policy.mjs";
import { readShellCommands } from "./shell-commands.mjs";

test("merge classification follows command positions actually executed by Bash", () => {
	const scratch = mkdtempSync(join(tmpdir(), "pfdsl-merge-shell-"));
	const marker = join(scratch, "invocations");
	// This substitute never invokes gh or the network; PATH has only this bin.
	writeFileSync(
		join(scratch, "gh"),
		'#!/bin/sh\nprintf "%s\\n" "$*" >> "$PFD_ORACLE_MARKER"\n',
		{ mode: 0o700 },
	);
	const cases = [
		"if gh pr merge 1; then :; fi",
		"! gh pr merge 1",
		"if true; then gh pr merge 1; fi",
		"if false; then :; elif gh pr merge 1; then :; fi",
		"if false; then :; else gh pr merge 1; fi",
		"while gh pr merge 1; do break; done",
		"until gh pr merge 1; do :; done",
		"for item in once; do gh pr merge 1; done",
		"{ gh pr merge 1; }",
		"time gh pr merge 1",
		"time -p gh pr merge 1",
		"time ! gh pr merge 1",
		"time -p ! gh pr merge 1",
		"{ time ! gh pr merge 1; }",
		"if ! command gh pr merge 1; then :; fi",
		"case x in x) gh pr merge 1;; esac",
		"if gh api -X PUT repos/o/r/pulls/1/merge; then :; fi",
		"! gh api graphql -f 'query=mutation { mergePullRequest(input:{pullRequestId:\"x\"}){clientMutationId} }'",
		"if gh pr view 1; then :; fi",
		"! gh pr view 1",
		"echo 'if gh pr merge 1'",
		"printf '%s' '! gh pr merge 1'",
		"for gh in pr merge; do :; done",
		"case gh in gh) :;; esac",
	];
	const violations = [];
	try {
		for (const command of cases) {
			writeFileSync(marker, "");
			const actual = spawnSync(
				"/bin/bash",
				["--noprofile", "--norc", "-c", command],
				{
					cwd: scratch,
					env: { PATH: scratch, PFD_ORACLE_MARKER: marker },
					encoding: "utf8",
					timeout: 10000,
				},
			);
			assert.ok(actual.status === 0 || actual.status === 1, actual.stderr);
			const calls = readFileSync(marker, "utf8");
			const ranMerge = /^(?:pr merge|api .*merge)/m.test(calls);
			const detected = findMergeCommand(command, {
				readShellCommands,
				stripLeadingNoise,
			});
			const decision = evaluateDelegationGuard(
				{ tool_name: "Bash", tool_input: { command } },
				{ supportsAsk: false },
			).decision;
			if (
				(!/time (?:-p )?!/.test(command) && Boolean(detected) !== ranMerge) ||
				decision !== (ranMerge ? "deny" : "allow")
			)
				violations.push({ command, calls, detected, decision });
		}
		assert.deepEqual(violations, []);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
});
