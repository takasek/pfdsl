import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SHELL_PARSER_ROOT } from "../setup-shell-parser.mjs";
import { run } from "./run-exec.mjs";
import {
	installShellParser,
	isShellParserInstalled,
	shellParserPath,
} from "./shell-parser-tool.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("a corrupt parser download is rejected before installing an executable", async () => {
	const target = mkdtempSync(join(root, "node_modules/pfdsl-parser-checksum-"));
	try {
		await assert.rejects(
			installShellParser(target, {
				fetchAsset: async () => ({
					ok: true,
					arrayBuffer: async () => Buffer.from("wrong artifact"),
				}),
			}),
			/checksum/,
		);
		assert.equal(existsSync(shellParserPath(target)), false);
	} finally {
		rmSync(target, { recursive: true, force: true });
	}
});

test("failed downloads preserve the missing-tool state", async () => {
	const target = mkdtempSync(join(root, "node_modules/pfdsl-parser-download-"));
	try {
		await assert.rejects(
			installShellParser(target, {
				fetchAsset: async () => ({ ok: false, status: 503 }),
			}),
			/HTTP 503/,
		);
		assert.equal(existsSync(shellParserPath(target)), false);
	} finally {
		rmSync(target, { recursive: true, force: true });
	}
});

test("the installer derives its root from its own location regardless of cwd", () => {
	assert.equal(SHELL_PARSER_ROOT, root);
	run(process.execPath, [join(root, "scripts/setup-shell-parser.mjs")], {
		cwd: join(root, "scripts"),
	});
	assert.equal(isShellParserInstalled(root), true);
	assert.equal(
		existsSync(join(root, "scripts/node_modules/.pfdsl-tools")),
		false,
	);
});
