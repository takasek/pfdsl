import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { installShellParser, shellParserPath } from "./shell-parser-tool.mjs";

test("a corrupt parser download is rejected before installing an executable", async () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-parser-checksum-"));
	try {
		await assert.rejects(
			installShellParser(root, {
				fetchAsset: async () => ({
					ok: true,
					arrayBuffer: async () => Buffer.from("wrong artifact"),
				}),
			}),
			/checksum/,
		);
		assert.equal(existsSync(shellParserPath(root)), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("failed downloads preserve the missing-tool state", async () => {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-parser-download-"));
	try {
		await assert.rejects(
			installShellParser(root, {
				fetchAsset: async () => ({ ok: false, status: 503 }),
			}),
			/HTTP 503/,
		);
		assert.equal(existsSync(shellParserPath(root)), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
