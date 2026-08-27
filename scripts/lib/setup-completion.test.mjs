import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sentinel = "node_modules/.pfdsl-setup-complete";

function sessionStartCommand(path) {
	const settings = JSON.parse(readFileSync(resolve(root, path), "utf8"));
	return settings.hooks.SessionStart[0].hooks[0].command;
}

describe("setup completion sentinel", () => {
	it("runs setup from the Claude source and generated Codex hook until the completion marker exists", () => {
		for (const path of [".claude/settings.json", ".codex/hooks.json"]) {
			const command = sessionStartCommand(path);
			assert.match(command, new RegExp(`\\[ ! -f ${sentinel} \\]`));
			assert.match(command, /make setup/);
		}
	});

	it("writes the completion marker after all setup actions", () => {
		const makefile = readFileSync(resolve(root, "Makefile"), "utf8");
		const start = makefile.indexOf("setup:");
		const setup = makefile.slice(start, makefile.indexOf("\n.PHONY:", start));
		const commands = [
			"pnpm install",
			"cp scripts/hooks/pre-commit-shim $$(git rev-parse --git-common-dir)/hooks/pre-commit",
			"chmod +x $$(git rev-parse --git-common-dir)/hooks/pre-commit",
			"node scripts/link-repo-skill.mjs",
			`touch ${sentinel}`,
		];
		let previous = -1;
		for (const command of commands) {
			const position = setup.indexOf(command);
			assert.ok(
				position > previous,
				`expected ${command} after the previous setup action`,
			);
			previous = position;
		}
	});
});
