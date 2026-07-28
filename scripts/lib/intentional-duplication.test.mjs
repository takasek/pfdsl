// Three pairs of code are duplicated on purpose — the hook may not import
// outside hooks/, and packages/ does not depend on the repo's tooling layer —
// and each pair had tests on both sides but nothing asserting the two still
// agree (#613). Tightening one copy would leave the other behind silently.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { detectDoneAddition as detectInPreCommit } from "./retro-reminder-check.mjs";
import { detectDoneAddition as detectInHook } from "../../hooks/retro-reminder-post-tool-use.mjs";
import { isDistStale } from "./dist-freshness.mjs";
import { PLUGIN_AGENT_EXCLUSIONS, PLUGIN_AGENT_FILES } from "./gen-plugin.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(resolve(root, rel), "utf-8");

/** The `const NAME = /…/;` literal in a source file, as written. */
function patternSourceOf(fileText, name) {
	const match = new RegExp(`const ${name} = (/.*/[a-z]*);`).exec(fileText);
	assert.ok(match, `${name} not found as a regex literal`);
	return match[1];
}

describe("retro-reminder: the pre-commit check and the plugin hook", () => {
	const preCommit = read("scripts/lib/retro-reminder-check.mjs");
	const hook = read("hooks/retro-reminder-post-tool-use.mjs");

	it("spell the done-addition pattern identically", () => {
		assert.equal(
			patternSourceOf(hook, "DONE_ADDITION_PATTERN"),
			patternSourceOf(preCommit, "DONE_ADDITION_PATTERN"),
		);
	});

	// Same inputs through both detectors: the diff shapes the coarse regex is
	// meant to separate, including the ones its comment calls acceptable.
	const diffs = [
		["an added done line", "+    status: done"],
		["an added done line among context", " artifact:\n+    status: done\n   label: x"],
		["a removed done line", "-    status: done"],
		["an unchanged done line", "     status: done"],
		["a file header, which starts with +++", "+++ b/.pfdsl/roadmap.pfdsl\n status: done"],
		["an added wip line", "+    status: wip"],
		["done with no space after the colon", "+    status:done"],
		["an empty diff", ""],
	];

	for (const [name, diff] of diffs) {
		it(`agree on ${name}`, () => {
			assert.equal(detectInHook(diff), detectInPreCommit(diff));
		});
	}
});

describe("dist-freshness: the tooling check and the cli-smoke copy", () => {
	const smokeText = read("packages/cli/src/cli-smoke.test.ts");

	/**
	 * The copy of newestMtimeUnder inside cli-smoke.test.ts, evaluated so the
	 * two implementations can be compared on the same directory rather than
	 * only as text — a reformat should not fail this, a behaviour change should.
	 */
	function smokeNewestMtimeUnder() {
		const body = /function newestMtimeUnder\(dir: string\): number \{([\s\S]*?)\n\}/.exec(smokeText);
		assert.ok(body, "cli-smoke.test.ts no longer defines newestMtimeUnder");
		const js = body[1].replaceAll(": number", "").replaceAll(": string", "");
		return new Function("readdirSync", "statSync", "join", `return function newestMtimeUnder(dir) {${js}\n}`)(
			readdirSync,
			statSync,
			join,
		);
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
			utimesSync(join(dir, "src", "nested", "b.ts"), later / 1000, later / 1000);

			const newestAfter = smokeNewestMtimeUnder()(join(dir, "src"));
			const smokeSaysCurrentAfter = statSync(distFile).mtimeMs >= newestAfter;
			assert.equal(smokeSaysCurrentAfter, false, "the smoke copy should see the newer source");
			assert.equal(smokeSaysCurrentAfter, !isDistStale(distFile));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("still states in cli-smoke.test.ts why the rule is restated rather than imported", () => {
		assert.match(smokeText, /dist-freshness\.mjs/);
	});
});

describe("PLUGIN_AGENT_FILES: the bundled list and .claude/agents/", () => {
	const onDisk = readdirSync(resolve(root, ".claude/agents"))
		.filter((f) => f.endsWith(".md"))
		.sort();

	it("accounts for every agent on disk, as either bundled or deliberately excluded", () => {
		const accounted = [
			...PLUGIN_AGENT_FILES,
			...Object.keys(PLUGIN_AGENT_EXCLUSIONS),
		].sort();
		assert.deepEqual(accounted, onDisk);
	});

	it("bundles only agents that exist", () => {
		for (const file of PLUGIN_AGENT_FILES) {
			assert.ok(onDisk.includes(file), `${file} is bundled but not in .claude/agents/`);
		}
	});

	it("gives a reason for each exclusion, so 'not bundled' is a decision and not an oversight", () => {
		for (const [file, reason] of Object.entries(PLUGIN_AGENT_EXCLUSIONS)) {
			assert.ok(reason.length > 0, `${file} is excluded without a reason`);
		}
	});
});
