import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

test("product WebKit PDF and browser canvas preserve dimensions and Japanese text", {
	skip: process.platform !== "darwin",
	timeout: 60000,
}, async () => {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const temporary = mkdtempSync(join(tmpdir(), "pfdsl-product-export-"));
	try {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="640pt" height="480pt" viewBox="0 0 640.2 480.4"><text x="20" y="45" font-size="24" font-family="sans-serif">日本語の成果物 Export</text><rect x="10" y="60" width="600" height="400" fill="none" stroke="black"/></svg>';
		writeFileSync(join(temporary, "input.svg"), svg);
		// Same envelope geometry/CSP as pdf.rs; its parser and 72/96 conversion are covered by native unit tests.
		writeFileSync(
			join(temporary, "input.html"),
			`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><style>html,body{margin:0;padding:0;width:480.15px;height:360.3px;background:white;overflow:hidden}svg{display:block;width:480.15px;height:360.3px}</style></head><body>${svg}</body></html>`,
		);
		await build({
			entryPoints: [join(root, "src/export-image.ts")],
			bundle: true,
			format: "iife",
			globalName: "PFDExport",
			outfile: join(temporary, "png.js"),
		});
		const executable = join(temporary, "probe");
		const compile = spawnSync(
			"/usr/bin/clang",
			[
				"-fobjc-arc",
				"-mmacosx-version-min=11.0",
				"-framework",
				"AppKit",
				"-framework",
				"WebKit",
				"-framework",
				"PDFKit",
				join(root, "src-tauri/native/pdf.m"),
				join(root, "test/native-export-probe.m"),
				"-o",
				executable,
			],
			{ encoding: "utf8" },
		);
		assert.equal(compile.status, 0, compile.stderr);
		const pdf = join(temporary, "output.pdf"),
			png = join(temporary, "output.png");
		const probe = spawnSync(
			executable,
			[
				join(temporary, "input.svg"),
				join(temporary, "input.html"),
				join(temporary, "png.js"),
				"481",
				"361",
				pdf,
				png,
			],
			{ encoding: "utf8", timeout: 40000 },
		);
		assert.equal(probe.status, 0, `${probe.stderr}\n${probe.stdout}`);
		const result = JSON.parse(probe.stdout.trim().split("\n").at(-1));
		assert.equal(result.pdfPages, 1);
		assert.ok(Math.abs(result.pdfWidth - 481) <= 0.1, JSON.stringify(result));
		assert.ok(Math.abs(result.pdfHeight - 361) <= 0.1, JSON.stringify(result));
		assert.match(result.pdfText, /日本語の成果物/);
		assert.equal(result.pngWidth, 641);
		assert.equal(result.pngHeight, 481);
		assert.ok(result.whiteCorner);
		const header = readFileSync(png);
		assert.equal(header.readUInt32BE(16), 641);
		assert.equal(header.readUInt32BE(20), 481);
		// Optional evidence destination is a local test output directory, never part of the product interface.
		if (process.env.PFDSL_EXPORT_TEST_EVIDENCE) {
			for (const name of ["output.pdf", "output.pdf.png", "output.png"])
				writeFileSync(
					join(process.env.PFDSL_EXPORT_TEST_EVIDENCE, name),
					readFileSync(join(temporary, name)),
				);
			writeFileSync(
				join(process.env.PFDSL_EXPORT_TEST_EVIDENCE, "result.json"),
				JSON.stringify(result, null, 2),
			);
		}
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});
