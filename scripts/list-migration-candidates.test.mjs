import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { tryGit, tryRun } from "./lib/run-exec.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = resolve(root, "scripts/list-migration-candidates.mjs");

const listing = (args) =>
	tryRun(process.execPath, [script, ...args], {
		cwd: root,
		captureStderr: true,
	});

// Commits between v0.0.26 and dc94909e that changed adopter-facing behavior but carry no `!` marker.
// They are the ones a listing keyed on commit markers missed.
const KNOWN_ADOPTER_COMMITS = [
	"1ecbbb24",
	"5685f158",
	"47fdc6b7",
	"29883428",
	"8a84b139",
	"313c490f",
];

describe("list-migration-candidates", () => {
	it("refuses to run without the start of the interval", () => {
		const result = listing([]);

		assert.equal(result.ok, false);
		assert.equal(result.status, 2);
		assert.match(result.out, /--from is required/);
	});

	it("refuses a flag it does not know", () => {
		const result = listing(["--from", "HEAD", "--since", "HEAD"]);

		assert.equal(result.ok, false);
		assert.equal(result.status, 2);
	});

	it("lists an empty interval as no output", () => {
		const result = listing(["--from", "HEAD", "--to", "HEAD"]);

		assert.equal(result.ok, true);
		assert.equal(result.out, "");
	});

	it("reports an unknown revision as a failure", () => {
		const result = listing(["--from", "no-such-revision-for-this-test"]);

		assert.equal(result.ok, false);
		assert.equal(result.status, 1);
	});

	it("keeps every known adopter-affecting commit of v0.0.26..dc94909e", (t) => {
		// A shallow clone or a checkout without tags cannot answer this; skip rather than report a false failure.
		for (const rev of ["v0.0.26", "dc94909e", ...KNOWN_ADOPTER_COMMITS]) {
			if (!tryGit(["cat-file", "-e", `${rev}^{commit}`], { cwd: root }).ok) {
				t.skip(`${rev} is not available in this checkout`);
				return;
			}
		}

		const result = listing(["--from", "v0.0.26", "--to", "dc94909e"]);

		assert.equal(result.ok, true);
		const listed = result.out
			.split("\n")
			.filter(Boolean)
			.map((line) => line.split(" ", 1)[0]);
		for (const commit of KNOWN_ADOPTER_COMMITS) {
			assert.ok(
				listed.some((hash) => commit.startsWith(hash)),
				`${commit} is missing from the listing`,
			);
		}
	});
});
