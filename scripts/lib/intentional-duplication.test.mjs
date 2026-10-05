// The distributed agent inventory is verified against the repository files.

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AGENT_EXCLUSIONS, DISTRIBUTED_AGENTS } from "./harness-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("DISTRIBUTED_AGENTS: the bundled list and .claude/agents/", () => {
	const onDisk = readdirSync(resolve(root, ".claude/agents"))
		.filter((f) => f.endsWith(".md"))
		.sort();

	it("accounts for every agent on disk, as either bundled or deliberately excluded", () => {
		const accounted = [
			...DISTRIBUTED_AGENTS,
			...Object.keys(AGENT_EXCLUSIONS),
		].sort();
		assert.deepEqual(accounted, onDisk);
	});

	it("bundles only agents that exist", () => {
		for (const file of DISTRIBUTED_AGENTS) {
			assert.ok(
				onDisk.includes(file),
				`${file} is bundled but not in .claude/agents/`,
			);
		}
	});

	it("gives a reason for each exclusion, so 'not bundled' is a decision and not an oversight", () => {
		for (const [file, reason] of Object.entries(AGENT_EXCLUSIONS)) {
			assert.ok(reason.length > 0, `${file} is excluded without a reason`);
		}
	});
});
