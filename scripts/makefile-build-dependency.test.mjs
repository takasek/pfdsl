// Cross-package imports resolve through each package's dist/, so a test or
// typecheck run that reads a build older than its sources can pass here and
// fail in CI (#642). The Makefile carries that dependency structurally: the
// targets that read dist/ depend on `build`, so there is no stale build to
// warn about. This test keeps that dependency in place, checked as data.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The prerequisites declared for a Makefile target, by name. */
function prerequisitesOf(target) {
	const makefile = readFileSync(resolve(root, "Makefile"), "utf8");
	const rule = new RegExp(`^${target}:([^\\n]*)$`, "m").exec(makefile);
	assert.ok(rule, `Makefile declares a "${target}" target`);
	return rule[1].trim().split(/\s+/).filter(Boolean);
}

describe("Makefile build dependency", () => {
	for (const target of ["test", "typecheck"]) {
		it(`makes "${target}" depend on "build" so it never reads a stale dist/`, () => {
			assert.ok(
				prerequisitesOf(target).includes("build"),
				`"${target}" lists "build" among its prerequisites`,
			);
		});
	}
});
