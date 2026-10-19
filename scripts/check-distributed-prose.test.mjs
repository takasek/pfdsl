import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");

it("checks canonical prose through the tracked distribution manifest scope", () => {
	const fixture = mkdtempSync(join(tmpdir(), "pfdsl-prose-entrypoint-"));
	try {
		cpSync(join(source, "scripts"), join(fixture, "scripts"), {
			recursive: true,
		});
		symlinkSync(
			join(source, "node_modules"),
			join(fixture, "node_modules"),
			"dir",
		);
		const shipped = "plugin/pfdsl/skills/pfd-ops/SKILL.md";
		mkdirSync(dirname(join(fixture, shipped)), { recursive: true });
		writeFileSync(
			join(fixture, shipped),
			"The generated copy is not the prose source.\n",
		);
		execFileSync("git", ["init", "-q", fixture]);
		execFileSync("git", ["-C", fixture, "add", shipped]);
		const canonical = join(
			fixture,
			"scripts/harness-template/skills/pfd-ops/SKILL.md",
		);
		const check = () =>
			spawnSync(
				process.execPath,
				[join(fixture, "scripts/check-distributed-prose.mjs")],
				{ cwd: fixture, encoding: "utf-8" },
			);
		for (const destination of [
			"https://github.com/takasek/pfdsl/issues/674",
			"<https://github.com/takasek/pfdsl/issues/674>",
		]) {
			for (const title of ["", ' "details"', " 'details'", " (details)"]) {
				writeFileSync(canonical, `See [#674](${destination}${title}).\n`);
				const resolved = check();
				assert.equal(
					resolved.status,
					0,
					`${destination}${title}: ${resolved.stderr}`,
				);
				assert.match(resolved.stdout, /OK \(1 file\(s\)\)/);
			}
		}
		writeFileSync(canonical, "See #674.\n");
		const bare = check();
		assert.equal(bare.status, 1, bare.stderr);
		assert.match(
			bare.stderr,
			/scripts\/harness-template\/skills\/pfd-ops\/SKILL.md:1: \[issue-ref\]/,
		);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
