import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Runs the bundled dist/cli.js as a real subprocess. Guards against bundling
// regressions (e.g. CJS deps wrapped without a require shim) that unit tests
// on src/ cannot catch. Requires `pnpm build` to have run first, as in CI.
const distCli = resolve(__dirname, "../dist/cli.js");

function newestMtimeUnder(dir: string): number {
	let newest = 0;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		const mtime = entry.isDirectory()
			? newestMtimeUnder(full)
			: statSync(full).mtimeMs;
		if (mtime > newest) newest = mtime;
	}
	return newest;
}

// Skipping on absence alone would let a leftover bundle from before the
// current source change pass this suite — it would report on code that is no
// longer what src/ says. Skip on staleness too, so a green run always means
// the bundle under test was built from the sources beside it. (Same rule as
// scripts/lib/dist-freshness.mjs, restated here rather than imported: that
// module belongs to the repo's own tooling layer, which packages/ does not
// depend on.)
const distIsCurrent =
	existsSync(distCli) &&
	statSync(distCli).mtimeMs >= newestMtimeUnder(__dirname);

describe("dist/cli.js smoke", () => {
	// A suite that skips every case is green, and reads as one that ran. CI
	// builds before it tests, so there the bundle must be current and the
	// skips must not fire; locally they still may (#607).
	it.runIf(process.env.CI)("has a current bundle to run against in CI", () => {
		expect(distIsCurrent).toBe(true);
	});

	it.skipIf(!distIsCurrent)("--help exits 0 with usage", () => {
		const stdout = execFileSync(process.execPath, [distCli, "--help"], {
			encoding: "utf8",
		});
		expect(stdout).toContain("pfdsl");
	});

	it.skipIf(!distIsCurrent)("--version prints semver", () => {
		const stdout = execFileSync(process.execPath, [distCli, "--version"], {
			encoding: "utf8",
		});
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});

	// Every case above exits 0, so cli.ts's own lines — choosing between binary
	// output and stdout, writing stderr, and passing the exit code to the
	// process — were never executed as themselves (#638). This is the failure
	// side of that boundary.
	it.skipIf(!distIsCurrent)(
		"passes a non-zero exit code and the message through to the process",
		() => {
			const missing = join(__dirname, "no-such-file.pfdsl");
			let status: number | undefined;
			let stderr = "";
			try {
				execFileSync(process.execPath, [distCli, "check", missing], {
					encoding: "utf8",
					stdio: "pipe",
				});
			} catch (e) {
				const err = e as { status?: number; stderr?: string };
				status = err.status;
				stderr = err.stderr ?? "";
			}
			expect(status).toBe(1);
			expect(stderr).toContain("no-such-file.pfdsl");
		},
	);

	// #428: stdin + --json success path hardcoded `diagnostics: []`, dropping	// #428: stdin + --json success path hardcoded `diagnostics: []`, dropping
	// warnings (e.g. W002) that both the file-path --json path and the stdin
	// non-json path do report.
	it.skipIf(!distIsCurrent)(
		"check - --json includes warnings from stdin input (#428)",
		() => {
			const src = "---\nartifact:\n  B:\n    status: done\n---\nA >> P -> B\n";
			const stdout = execFileSync(
				process.execPath,
				[distCli, "check", "-", "--json"],
				{ encoding: "utf8", input: src },
			);
			const parsed = JSON.parse(stdout);
			expect(parsed.ok).toBe(true);
			expect(
				(parsed.diagnostics as Array<{ code: string }>).some(
					(d) => d.code === "W002",
				),
			).toBe(true);
		},
	);
});
