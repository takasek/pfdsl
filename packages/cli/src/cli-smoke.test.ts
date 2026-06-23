import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Runs the bundled dist/cli.js as a real subprocess. Guards against bundling
// regressions (e.g. CJS deps wrapped without a require shim) that unit tests
// on src/ cannot catch. Requires `pnpm build` to have run first, as in CI.
const distCli = resolve(__dirname, "../dist/cli.js");

describe("dist/cli.js smoke", () => {
	it.skipIf(!existsSync(distCli))("--help exits 0 with usage", () => {
		const stdout = execFileSync(process.execPath, [distCli, "--help"], {
			encoding: "utf8",
		});
		expect(stdout).toContain("pfdsl");
	});

	it.skipIf(!existsSync(distCli))("--version prints semver", () => {
		const stdout = execFileSync(process.execPath, [distCli, "--version"], {
			encoding: "utf8",
		});
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});
});
