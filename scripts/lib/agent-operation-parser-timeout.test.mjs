import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { corpusFacts } from "./agent-operation-corpus.mjs";
import { evaluateAgentOperationPolicy } from "./agent-operation-policy.mjs";
import { parserRecoveryCommand } from "./agent-operation-table.mjs";
import { readShell } from "./shell-commands.mjs";

test("property 4: a timed-out parser denies with same-agent retry, not installation or repair", () => {
	const root = mkdtempSync(
		fileURLToPath(
			new URL("../../node_modules/pfdsl-parser-timeout-", import.meta.url),
		),
	);
	try {
		const parserPath = join(root, "parser");
		writeFileSync(
			parserPath,
			`#!${process.execPath}\nsetInterval(() => {}, 1000);\n`,
		);
		chmodSync(parserPath, 0o755);
		const shell = readShell("git status", { parserPath });
		assert.equal(shell.failure, "parser-timeout");
		assert.match(shell.error, /temporary|temporarily/i);
		assert.match(shell.error, /retry/i);
		assert.doesNotMatch(shell.error, /missing|install|repair/i);
		for (const harness of ["claude", "codex"])
			for (const command of ["git status", parserRecoveryCommand(root)]) {
				const payload = { tool_name: "Bash", tool_input: { command } };
				const result = evaluateAgentOperationPolicy(
					payload,
					corpusFacts({ harness, hookRoot: root, shell }),
				);
				assert.equal(result.decision, "deny");
				assert.equal(result.recovery, "rewrite");
				assert.match(result.reason, /temporary|temporarily/i);
				assert.match(result.reason, /retry/i);
				assert.doesNotMatch(result.reason, /missing|install|repair/i);
			}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
