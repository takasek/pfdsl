// Cross-package imports resolve through each package's dist/, so a test or
// typecheck run that reads a build older than its sources can pass here and
// fail in CI (#642). The repo's shared entry points carry that dependency
// structurally: the Makefile targets that read dist/ depend on `build`, and
// the root package scripts build before they run, so there is no stale build
// to warn about. A package-scoped run (`pnpm --filter <pkg> test`) or a direct
// `node packages/*/dist/...` call is outside those entry points and stays the
// caller's responsibility (#1209). This test keeps the dependency in place,
// checked as data.

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

/** The command a root package.json script runs, by name. */
function rootScript(name) {
	const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
	const script = pkg.scripts?.[name];
	assert.ok(script, `package.json declares a "${name}" script`);
	return script;
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

describe("root script build dependency", () => {
	for (const name of ["test", "typecheck"]) {
		it(`builds before running "${name}", so the pnpm entry point guarantees what the Makefile one does`, () => {
			const steps = rootScript(name)
				.split("&&")
				.map((step) => step.trim());
			assert.match(
				steps[0],
				/\bbuild\b/,
				`the "${name}" script builds before anything else`,
			);
			assert.ok(
				steps.slice(1).some((step) => step.includes(name)),
				`the "${name}" script still runs ${name} after the build`,
			);
		});
	}
});
