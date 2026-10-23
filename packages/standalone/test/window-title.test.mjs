import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build, root } from "./helpers/host-bundle.mjs";

test("native title writes serialize and converge after delayed and rejected updates", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pfdsl-title-"));
	try {
		const output = join(dir, "title.mjs");
		await build({
			entryPoints: [`${root}/packages/standalone/src/window-title.ts`],
			outfile: output,
			bundle: true,
			format: "esm",
			platform: "node",
		});
		const { createWindowTitle } = await import(pathToFileURL(output).href);
		const writes = [],
			failures = [];
		let finish;
		const update = createWindowTitle(
			(title) => {
				writes.push(title);
				return new Promise((resolve, reject) => {
					finish = { resolve, reject };
				});
			},
			(error) => failures.push(error),
		);
		update("A");
		update("B");
		update("PFDSL");
		assert.deepEqual(writes, ["A"]);
		finish.resolve();
		await new Promise(setImmediate);
		assert.deepEqual(writes, ["A", "PFDSL"]);
		finish.reject("denied");
		await new Promise(setImmediate);
		assert.deepEqual(failures, ["denied"]);
		update("PFDSL");
		assert.deepEqual(writes, ["A", "PFDSL", "PFDSL"]);
		finish.resolve();
		await new Promise(setImmediate);
		update("PFDSL");
		assert.equal(writes.length, 3);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
