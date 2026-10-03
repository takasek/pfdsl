import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumers = [
	{
		script: "scripts/check-closes-reference.mjs",
		args: ["--pr", "1", "--base", "main", "--default-branch", "main"],
		unavailable: 0,
	},
	{
		script: "scripts/check-roadmap-registration.mjs",
		args: ["--pr", "1"],
		unavailable: 0,
	},
	{ script: "scripts/pfdsl/audit-issues-flow.mjs", args: [], unavailable: 2 },
];
for (const consumer of consumers) {
	for (const mode of ["unavailable", "authentication", "remote-failure"]) {
		it(`${consumer.script}: ${mode} preserves the consumer exit contract`, () => {
			const bin = mkdtempSync(join(tmpdir(), "github-consumer-availability-"));
			try {
				const env = { ...process.env, PATH: bin };
				delete env.GH_TOKEN;
				delete env.GITHUB_TOKEN;
				if (mode === "authentication")
					writeFileSync(
						join(bin, "gh"),
						`#!${process.execPath}\nconsole.error("authentication failed"); process.exit(1);\n`,
						{ mode: 0o755 },
					);
				if (mode === "remote-failure") env.GH_TOKEN = "test-token";
				const result = spawnSync(
					process.execPath,
					[join(root, consumer.script), ...consumer.args],
					{ cwd: root, env, encoding: "utf8" },
				);
				assert.equal(
					result.status,
					mode === "unavailable" ? consumer.unavailable : 1,
					result.stdout + result.stderr,
				);
				if (mode === "unavailable")
					assert.match(result.stdout, /GitHub operation[s]? unavailable/);
				else
					assert.doesNotMatch(result.stdout, /SKIP|skipping GitHub-dependent/);
			} finally {
				rmSync(bin, { recursive: true, force: true });
			}
		});
	}
}
