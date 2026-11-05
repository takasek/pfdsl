import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

test("generated run index links reach the authoritative checkout documents", async () => {
	const parent = await mkdtemp(join(tmpdir(), "pfdsl-kit-links-"));
	try {
		const target = join(parent, "run with spaces");
		await promisify(execFile)(process.execPath, [
			fileURLToPath(new URL("../acceptance-kit/prepare.mjs", import.meta.url)),
			target,
		]);
		const index = await readFile(join(target, "README.md"), "utf8");
		for (const name of ["ACCEPTANCE-PLAN.md", "ACCEPTANCE-HANDOFF.md"]) {
			const link = [...index.matchAll(/\]\(([^)]+)\)/g)].find((match) =>
				match[1].endsWith(name),
			);
			assert.ok(link, `Missing link to ${name}`);
			const resolved = new URL(
				link[1],
				pathToFileURL(join(target, "README.md")),
			);
			const expected = new URL(`../${name}`, import.meta.url);
			assert.equal(resolved.href, expected.href);
			assert.equal(
				await readFile(resolved, "utf8"),
				await readFile(expected, "utf8"),
			);
		}
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
});
