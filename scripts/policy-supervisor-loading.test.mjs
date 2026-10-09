import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const source = new URL("./", import.meta.url);
for (const failure of ["missing", "syntax"])
	test(`a ${failure} supervisor blocks before loading a policy`, () => {
		const root = mkdtempSync(join(tmpdir(), "pfdsl-supervisor-load-"));
		try {
			mkdirSync(join(root, "lib"));
			cpSync(
				new URL("delegation-guard.mjs", source),
				join(root, "delegation-guard.mjs"),
			);
			cpSync(new URL("lib/hook-io.mjs", source), join(root, "lib/hook-io.mjs"));
			writeFileSync(
				join(root, "lib/delegation-guard.mjs"),
				"export const runDelegationGuard = () => ({shouldOutput:false});\n",
			);
			if (failure === "syntax")
				writeFileSync(join(root, "lib/policy-supervisor.mjs"), "export {\n");
			const result = spawnSync(
				process.execPath,
				[join(root, "delegation-guard.mjs")],
				{
					input: JSON.stringify({
						tool_name: "Read",
						tool_input: { file_path: "/fixture/source" },
					}),
					encoding: "utf8",
				},
			);
			assert.equal(result.status, 2, result.stdout + result.stderr);
			assert.equal(
				JSON.parse(result.stdout).hookSpecificOutput.permissionDecision,
				"deny",
			);
			assert.match(result.stderr, /policy-supervisor|Unexpected end of input/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
