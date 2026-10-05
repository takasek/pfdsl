import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function runScanner(source, extension = "mjs") {
	const fixture = mkdtempSync(join(tmpdir(), "pfdsl-cli-conventions-"));
	try {
		mkdirSync(join(fixture, "scripts"));
		copyFileSync(
			join(root, "scripts/check-cli-conventions.mjs"),
			join(fixture, "scripts/check-cli-conventions.mjs"),
		);
		symlinkSync(join(root, "scripts/lib"), join(fixture, "scripts/lib"), "dir");
		writeFileSync(join(fixture, `candidate.${extension}`), source);
		execFileSync("git", ["init", "--quiet"], { cwd: fixture });
		execFileSync("git", ["add", "--", `candidate.${extension}`], {
			cwd: fixture,
		});
		return spawnSync(
			process.execPath,
			[join(fixture, "scripts/check-cli-conventions.mjs")],
			{ cwd: fixture, encoding: "utf8" },
		);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
}

it("reports only the retired-shape check when strict parsing is absent", () => {
	const result = runScanner("parseArgs({ args, strict: false });\n");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /no retired argv shapes found in 1 script\(s\)/);
	assert.doesNotMatch(result.stdout, /parse argv strictly/);
});

it("rejects tracked retired argv shapes with their source line", () => {
	for (const source of [
		'args.includes("--fix");\n',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: source fixture, not interpolation
		"if (import.meta.url === `file://${process.argv[1]}`) main();\n",
	]) {
		const result = runScanner(source);
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stdout, /candidate\.mjs:1:/);
		assert.match(result.stdout, /retired argv shape\(s\) found/);
	}
});

it("keeps the tracked mjs inventory boundary", () => {
	const result = runScanner('args.includes("--fix");\n', "txt");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /no retired argv shapes found in 0 script\(s\)/);
});
