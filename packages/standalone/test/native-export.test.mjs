import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeExportSources } from "@pfdsl/editor";
import { renderDotToSvg } from "@pfdsl/preview-engine";
import { build } from "esbuild";
import { processSnapshot } from "../src/processing.ts";

test("product WebKit PDF and browser canvas preserve dimensions and Japanese text", {
	skip: process.platform !== "darwin",
	timeout: 180000,
}, async (t) => {
	const root = fileURLToPath(new URL("../", import.meta.url));
	const temporary = mkdtempSync(join(tmpdir(), "pfdsl-product-export-"));
	try {
		const cargo = process.env.CARGO ?? join(homedir(), ".cargo/bin/cargo");
		const manifest = join(root, "src-tauri/Cargo.toml");
		const metadata = spawnSync(
			cargo,
			[
				"+stable",
				"metadata",
				"--manifest-path",
				manifest,
				"--no-deps",
				"--format-version",
				"1",
			],
			{ encoding: "utf8" },
		);
		assert.equal(metadata.status, 0, metadata.stderr);
		const compiled = spawnSync(
			cargo,
			[
				"+stable",
				"build",
				"--manifest-path",
				manifest,
				"--locked",
				"--example",
				"pdf-envelope",
			],
			{ encoding: "utf8", timeout: 120000 },
		);
		assert.equal(compiled.status, 0, compiled.stderr);
		const envelope = join(
			JSON.parse(metadata.stdout).target_directory,
			"debug/examples/pdf-envelope",
		);
		function preparePdf(svg, width, height) {
			writeFileSync(join(temporary, "input.svg"), svg);
			const prepared = spawnSync(
				envelope,
				[join(temporary, "input.svg"), String(width), String(height)],
				{ encoding: "utf8" },
			);
			assert.equal(prepared.status, 0, prepared.stderr);
			const input = JSON.parse(prepared.stdout);
			writeFileSync(join(temporary, "input.html"), input.html);
			return input;
		}
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="640pt" height="480pt" viewBox="0 0 640.2 480.4"><text x="20" y="45" font-size="24" font-family="sans-serif">日本語の成果物 Export</text><rect x="10" y="60" width="600" height="400" fill="none" stroke="black"/></svg>';
		const initial = preparePdf(svg, 640.2, 480.4);
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
		const evidence = process.env.PFDSL_EXPORT_TEST_EVIDENCE;
		const repository = fileURLToPath(new URL("../../../", import.meta.url));
		const runProbe = (input, pdfPath, pngPath, query) =>
			spawnSync(
				executable,
				[
					join(temporary, "input.svg"),
					join(temporary, "input.html"),
					join(temporary, "png.js"),
					String(input.width),
					String(input.height),
					pdfPath,
					pngPath,
				],
				{
					encoding: "utf8",
					timeout: 40000,
					env: query
						? { ...process.env, PFDSL_EXPORT_TEST_QUERY: query }
						: process.env,
				},
			);
		const probe = runProbe(
			initial,
			pdf,
			png,
			evidence ? "日本語の成果物" : undefined,
		);
		assert.equal(probe.status, 0, `${probe.stderr}\n${probe.stdout}`);
		const result = JSON.parse(probe.stdout.trim().split("\n").at(-1));
		// Keep evidence from the built-in fixture even if a later assertion fails.
		if (evidence) {
			for (const name of ["input.svg", "input.html", "output.pdf"])
				writeFileSync(
					join(evidence, name),
					readFileSync(join(temporary, name)),
				);
			writeFileSync(
				join(evidence, "result.json"),
				JSON.stringify(result, null, 2),
			);
			const small =
				"---\nartifact:\n  draft: { label: 日本語の原稿 }\n  report: { label: 日本語の成果物 }\nprocess:\n  write: { label: 日報を書く }\n---\ndraft >> write -> report\n";
			const chinese = "简体中文资料";
			const mixed = small.replace("日本語の原稿", chinese);
			const cases = [
				{ name: "small-unset", source: small },
				{ name: "small-ja", source: small, lang: "ja" },
				{ name: "small-font", source: small, font: "Hiragino Sans" },
				{ name: "mixed-unset", source: mixed, additionalQuery: chinese },
				{
					name: "mixed-ja",
					source: mixed,
					lang: "ja",
					additionalQuery: chinese,
				},
			];
			for (const { name, source, lang, font, additionalQuery } of cases) {
				await t.test(`diagnostic PFD export: ${name}`, async () => {
					const prepared = await processSnapshot(
						source,
						join(temporary, "manuscript.pfdsl"),
						async () => null,
					);
					assert.equal(prepared.message.type, "render", name);
					const { dot } = computeExportSources(
						prepared.model.graph,
						prepared.frontmatter,
					);
					const standardSvg = await renderDotToSvg(dot);
					if (font) assert.match(standardSvg, /font-family="Times,serif"/);
					const graphSvg = font
						? standardSvg.replaceAll(
								'font-family="Times,serif"',
								`font-family="${font},Times,serif"`,
							)
						: standardSvg;
					const [, , width, height] = graphSvg
						.match(/viewBox="([^"]+)"/)[1]
						.split(/\s+/)
						.map(Number);
					const input = preparePdf(graphSvg, width, height);
					if (lang) {
						const inputHtml = join(temporary, "input.html");
						const html = readFileSync(inputHtml, "utf8");
						assert.match(html, /<html>/);
						writeFileSync(
							inputHtml,
							html.replace("<html>", `<html lang="${lang}">`),
						);
					}
					const folder = join(evidence, name);
					mkdirSync(folder);
					for (const filename of ["input.svg", "input.html"])
						writeFileSync(
							join(folder, filename),
							readFileSync(join(temporary, filename)),
						);
					writeFileSync(join(folder, "source.pfdsl"), source);
					const output = runProbe(
						input,
						join(folder, "output.pdf"),
						join(temporary, `${name}.png`),
						["日本語の成果物", additionalQuery].filter(Boolean).join("\n"),
					);
					const json = output.stdout?.trim().split("\n").at(-1);
					if (json) writeFileSync(join(folder, "result.json"), json);
					assert.equal(output.status, 0, `${output.stderr}\n${output.stdout}`);
				});
			}
		}
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
		if (evidence)
			for (const name of ["output.pdf.png", "output.png"])
				writeFileSync(
					join(evidence, name),
					readFileSync(join(temporary, name)),
				);
		const files = globSync("docs/samples/*.pfdsl", { cwd: repository })
			.sort()
			.concat([
				".pfdsl/roadmap.pfdsl",
				".pfdsl/workflow.pfdsl",
				".pfdsl/pipeline.pfdsl",
			]);
		assert.ok(files.length > 0);
		for (const relative of files)
			await t.test(relative, async () => {
				const path = join(repository, relative);
				const prepared = await processSnapshot(
					readFileSync(path, "utf8"),
					path,
					async (file) => {
						try {
							return readFileSync(file, "utf8");
						} catch {
							return null;
						}
					},
				);
				assert.equal(prepared.message.type, "render", relative);
				const sources = computeExportSources(
					prepared.model.graph,
					prepared.frontmatter,
				);
				const graphSvg = await renderDotToSvg(sources.dot);
				const box = graphSvg
					.match(/viewBox="([^"]+)"/)[1]
					.split(/\s+/)
					.map(Number);
				const width = box[2],
					height = box[3];
				for (const [format, content] of Object.entries({
					...sources,
					svg: graphSvg,
				}))
					writeFileSync(join(temporary, `corpus.${format}`), content);
				assert.match(
					readFileSync(join(temporary, "corpus.dot"), "utf8"),
					/digraph/,
				);
				assert.match(
					readFileSync(join(temporary, "corpus.tsv"), "utf8"),
					/^kind\tid\tlabel/,
				);
				const input = preparePdf(graphSvg, width, height);
				const output = spawnSync(
					executable,
					[
						join(temporary, "input.svg"),
						join(temporary, "input.html"),
						join(temporary, "png.js"),
						String(input.width),
						String(input.height),
						pdf,
						png,
					],
					{ encoding: "utf8", timeout: 40000 },
				);
				assert.equal(
					output.status,
					0,
					`${relative}: ${output.stderr}\n${output.stdout}`,
				);
				const result = JSON.parse(output.stdout.trim().split("\n").at(-1));
				assert.equal(result.pdfPages, 1);
				assert.equal(result.pdfWidth, Math.ceil(width * 0.75));
				assert.equal(result.pdfHeight, Math.ceil(height * 0.75));
				const header = readFileSync(png);
				assert.equal(header.readUInt32BE(16), Math.ceil(width));
				assert.equal(header.readUInt32BE(20), Math.ceil(height));
				if (prepared.model.graph.nodes.size > 0)
					assert.ok(
						result.pdfText.trim().length > 0,
						`${relative}: PDF retains text`,
					);
			});
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
});
