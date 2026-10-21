import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { tryRun } from "./run-exec.mjs";

test("the regression suite kills a mutant that permits ungated push", () => {
	const dir = mkdtempSync(join(tmpdir(), "pfdsl-1486-mutation-"));
	try {
		const original = readFileSync(
			new URL("./push-check-chain.mjs", import.meta.url),
			"utf8",
		);
		const mutant = original.replace(
			'if (type === "push" && sawCheck && broken)',
			'if (type === "push" && sawCheck && false)',
		);
		assert.notEqual(mutant, original);
		writeFileSync(
			join(dir, "mutant.mjs"),
			mutant
				.replace(
					/from "(\.\/[^"]+)"/g,
					(_match, relative) =>
						`from "${new URL(relative, import.meta.url).href}"`,
				)
				.replace(
					'new URL("../../", import.meta.url)',
					`new URL("${new URL("../../", import.meta.url).href}")`,
				),
		);
		const suite = readFileSync(
			new URL("./push-check-chain.test.mjs", import.meta.url),
			"utf8",
		).replace(
			'"./push-check-chain.mjs"',
			JSON.stringify(pathToFileURL(join(dir, "mutant.mjs")).href),
		);
		const suitePath = join(dir, "regression.test.mjs");
		writeFileSync(suitePath, suite);
		const env = { ...process.env };
		delete env.NODE_TEST_CONTEXT;
		const result = tryRun(process.execPath, ["--test", suitePath], {
			cwd: dir,
			captureStderr: true,
			env,
		});
		assert.equal(result.status, 1);
		assert.match(result.out, /denies.*make test; git push/);
		assert.match(result.out, /denies.*make build x; make test x/);
		assert.match(result.out, /AssertionError/);
		assert.doesNotMatch(result.out, /ERR_MODULE_NOT_FOUND/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
