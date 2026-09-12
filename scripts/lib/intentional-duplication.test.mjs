// Repository/tooling duplication boundaries are verified against both consumers.

import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isDistStale } from "./dist-freshness.mjs";
import { AGENT_EXCLUSIONS, DISTRIBUTED_AGENTS } from "./harness-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(root, rel), "utf-8");

describe("dist-freshness: the tooling check and the cli-smoke copy", () => {
	const smokeText = read("packages/cli/src/cli-smoke.test.ts");

	/**
	 * The copy of newestMtimeUnder inside cli-smoke.test.ts, evaluated so the
	 * two implementations can be compared on the same directory rather than
	 * only as text — a reformat should not fail this, a behaviour change should.
	 */
	function smokeNewestMtimeUnder() {
		const body =
			/function newestMtimeUnder\(dir: string\): number \{([\s\S]*?)\n\}/.exec(
				smokeText,
			);
		assert.ok(body, "cli-smoke.test.ts no longer defines newestMtimeUnder");
		const js = body[1].replaceAll(": number", "").replaceAll(": string", "");
		return new Function(
			"readdirSync",
			"statSync",
			"join",
			`return function newestMtimeUnder(dir) {${js}\n}`,
		)(readdirSync, statSync, join);
	}

	it("compares a dist file against src/ the same way", () => {
		const dir = mkdtempSync(join(tmpdir(), "dup-dist-"));
		try {
			mkdirSync(join(dir, "src"));
			mkdirSync(join(dir, "src", "nested"));
			mkdirSync(join(dir, "dist"));
			writeFileSync(join(dir, "src", "a.ts"), "a");
			writeFileSync(join(dir, "src", "nested", "b.ts"), "b");
			const distFile = join(dir, "dist", "cli.js");
			writeFileSync(distFile, "built");

			const newest = smokeNewestMtimeUnder()(join(dir, "src"));
			const smokeSaysCurrent = statSync(distFile).mtimeMs >= newest;
			assert.equal(smokeSaysCurrent, !isDistStale(distFile));

			// Touch a source file so the built output is now behind it.
			const later = Date.now() + 5_000;
			utimesSync(
				join(dir, "src", "nested", "b.ts"),
				later / 1000,
				later / 1000,
			);

			const newestAfter = smokeNewestMtimeUnder()(join(dir, "src"));
			const smokeSaysCurrentAfter = statSync(distFile).mtimeMs >= newestAfter;
			assert.equal(
				smokeSaysCurrentAfter,
				false,
				"the smoke copy should see the newer source",
			);
			assert.equal(smokeSaysCurrentAfter, !isDistStale(distFile));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("still states in cli-smoke.test.ts why the rule is restated rather than imported", () => {
		assert.match(smokeText, /dist-freshness\.mjs/);
	});
});

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
