// The wiring in .claude/settings.json, checked as data.
//
// A script wired to two events runs twice per tool call, spawning a second
// process and, unless it behaves differently per event, saying the same thing
// twice. Neither is worth paying for, so nothing should be wired twice. Which
// single event a given hook belongs on is decided where that hook lives —
// see buildAdvisoryOutput in lib/hook-io.mjs for the advisory case (#929).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every wired hook command, with the events it is wired to. */
function wiringByCommand() {
	const settings = JSON.parse(
		readFileSync(resolve(root, ".claude/settings.json"), "utf8"),
	);
	const wiring = new Map();
	for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
		for (const group of groups) {
			for (const hook of group.hooks ?? []) {
				const events = wiring.get(hook.command) ?? [];
				events.push(`${event}[${group.matcher ?? "*"}]`);
				wiring.set(hook.command, events);
			}
		}
	}
	return wiring;
}

describe(".claude/settings.json hook wiring", () => {
	it("wires no command to more than one event", () => {
		const duplicates = [...wiringByCommand()]
			.filter(([, events]) => events.length > 1)
			.map(([command, events]) => `${command} -> ${events.join(", ")}`);
		assert.deepEqual(duplicates, []);
	});

	it("wires the stale-dist advisory to PostToolUse, where it reaches the model", () => {
		assert.deepEqual(
			wiringByCommand().get("node scripts/stale-dist-guard.mjs"),
			["PostToolUse[Bash]"],
		);
	});
});
