import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { parentDecision } from "./guard-effect-oracle-harness.mjs";

test("config tracking agrees with failed readonly unsets in the shell", () => {
	const violations = [];
	for (const declaration of [
		"readonly GIT_CONFIG_COUNT",
		"readonly -- GIT_CONFIG_COUNT",
		"declare -r GIT_CONFIG_COUNT",
		"declare -rx GIT_CONFIG_COUNT",
		"typeset -r GIT_CONFIG_COUNT",
		"readonly -p GIT_CONFIG_COUNT",
		"readonly -f GIT_CONFIG_COUNT",
		"declare -p GIT_CONFIG_COUNT",
		"declare -rp GIT_CONFIG_COUNT",
		"declare +i -r GIT_CONFIG_COUNT",
		"typeset +i -r GIT_CONFIG_COUNT",
		"declare +x -r GIT_CONFIG_COUNT; export GIT_CONFIG_COUNT",
		"declare -r +x GIT_CONFIG_COUNT; export GIT_CONFIG_COUNT",
		"declare -r +r GIT_CONFIG_COUNT",
		"declare +r -r GIT_CONFIG_COUNT",
		"declare -ir GIT_CONFIG_COUNT",
		"declare +i GIT_CONFIG_COUNT",
		"readonly +r GIT_CONFIG_COUNT",
		"readonly +p GIT_CONFIG_COUNT",
		"declare +p -r GIT_CONFIG_COUNT",
		"declare +f -r GIT_CONFIG_COUNT",
		"declare +pr GIT_CONFIG_COUNT",
		"typeset +p -r GIT_CONFIG_COUNT",
		"readonly GIT_CONFIG_COUNT; typeset +r GIT_CONFIG_COUNT",
		...["readonly", "declare", "typeset"].flatMap((head) =>
			[
				"-r",
				"-pr",
				"-rp",
				"+r",
				"+pr",
				"+rp",
				"-fr",
				"-rf",
				"+fr",
				"+rf",
				"+p -r",
				"-r +p",
				"+f -r",
				"-r +f",
				"-f +f -r",
				"+f -f -r",
			].map((options) => `${head} ${options} GIT_CONFIG_COUNT`),
		),
	]) {
		for (const options of [[], ["--"], ["-v", "--"]]) {
			const prefix = `export GIT_CONFIG_COUNT=1; ${declaration}; unset ${options.join(" ")} GIT_CONFIG_COUNT; `;
			const actual = spawnSync(
				"bash",
				[
					"--noprofile",
					"--norc",
					"-c",
					`${prefix}printf '\\nstate=%s' "\${GIT_CONFIG_COUNT-unset}"`,
				],
				{
					env: Object.fromEntries(
						Object.entries(process.env).filter(
							([name]) => !name.startsWith("GIT_"),
						),
					),
					encoding: "utf8",
				},
			);
			assert.equal(actual.status, 0, actual.stderr);
			const remaining = actual.stdout.split("\nstate=").at(-1);
			const decision = parentDecision(
				`${prefix}git fetch origin`,
				"/repo/feature",
			);
			const expected = remaining === "unset" ? "allow" : "ask";
			if (decision !== expected)
				violations.push({ prefix, decision, expected });
		}
	}
	assert.deepEqual(violations, []);
});
