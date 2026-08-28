import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	findCliConventionViolations,
	selectScannedFiles,
} from "./check-cli-conventions.mjs";

describe("findCliConventionViolations — argv flag lookup", () => {
	it("flags indexOf with a flag name", () => {
		const found = findCliConventionViolations(
			`const i = args.indexOf("--base");`,
		);
		assert.equal(found.length, 1);
		assert.match(found[0].reason, /parseArgs/);
	});

	it("flags includes with a flag name", () => {
		assert.equal(
			findCliConventionViolations(`const fix = process.argv.includes("--fix");`)
				.length,
			1,
		);
	});

	it("flags startsWith with a flag name, the inline form's usual reader", () => {
		assert.equal(
			findCliConventionViolations(`argv.find((a) => a.startsWith("--since="));`)
				.length,
			1,
		);
	});

	// The bare "--" is how a help-text formatter tells a flag line from a
	// description line — no flag name, no argv, nothing to get wrong.
	it("leaves a bare -- prefix test alone", () => {
		assert.equal(
			findCliConventionViolations(
				`if (!detail[1].startsWith("--")) last.desc = detail[1];`,
			).length,
			0,
		);
	});

	// The patterns have to appear in prose that explains why they were retired,
	// including in this repo's own migration comments.
	it("ignores the patterns inside comments", () => {
		const source = [
			'// strict parsing, not indexOf("--out"): the inline form was',
			' * includes("--fix") answers false for --fix=true',
		].join("\n");
		assert.deepEqual(findCliConventionViolations(source), []);
	});

	it("accepts the parseArgs form", () => {
		const source = `const { values } = parseArgs({ args, options: { base: { type: "string" } }, strict: true });`;
		assert.deepEqual(findCliConventionViolations(source), []);
	});
});

describe("findCliConventionViolations — entrypoint detection", () => {
	it("flags a raw string comparison against process.argv[1]", () => {
		const found = findCliConventionViolations(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source under test, not an interpolation
			"if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {",
		);
		assert.equal(found.length, 1);
		assert.match(found[0].reason, /isCliEntrypoint/);
	});

	it("accepts a comparison that resolves the realpath first", () => {
		const source =
			"if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {";
		assert.deepEqual(findCliConventionViolations(source), []);
	});

	it("accepts the shared helper", () => {
		assert.deepEqual(
			findCliConventionViolations(
				"if (isCliEntrypoint(import.meta.url, process.argv[1])) {",
			),
			[],
		);
	});

	it("reports the 1-indexed line", () => {
		const source = [
			"const a = 1;",
			"",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source under test, not an interpolation
			"if (import.meta.url === `file://${process.argv[1]}`) {}",
		].join("\n");
		assert.equal(findCliConventionViolations(source)[0].line, 3);
	});
});

describe("selectScannedFiles", () => {
	it("scans tracked .mjs anywhere, not a fixed list of directories", () => {
		const files = selectScannedFiles([
			"scripts/a.mjs",
			"hooks/b.mjs",
			"packages/vscode-extension/esbuild.config.mjs",
		]);
		assert.deepEqual(files, [
			"scripts/a.mjs",
			"hooks/b.mjs",
			"packages/vscode-extension/esbuild.config.mjs",
		]);
	});

	it("skips non-.mjs files", () => {
		assert.deepEqual(selectScannedFiles(["scripts/a.ts", "README.md"]), []);
	});

	// The detector and its tests hold the retired patterns as data.
	it("skips tests and the detector itself", () => {
		const files = selectScannedFiles([
			"scripts/lib/check-cli-conventions.mjs",
			"scripts/lib/x.test.mjs",
		]);
		assert.deepEqual(files, []);
	});

	// Generated mirror of hooks/ and .claude/skills/; the sources are scanned
	// and gen-plugin's identity gate keeps the copy equal to them.
	it("skips the generated plugin mirror", () => {
		assert.deepEqual(selectScannedFiles(["plugin/pfdsl/hooks/h.mjs"]), []);
	});

	// This one parses *other* commands' argv, not its own — the shape is the
	// point of the file. Excluded by name rather than by trying to tell whose
	// argv an array holds, which is the analysis check-no-shell-strings.mjs
	// records as having failed for it.
	it("skips the guard that inspects other commands' arguments", () => {
		assert.deepEqual(
			selectScannedFiles(["scripts/lib/command-usage-guard.mjs"]),
			[],
		);
	});
});

describe("per-rule exemptions", () => {
	const CHECK_INSTALL_SYNC_MIRRORS = [
		".claude/skills/pfd-ops/scripts/check-install-sync.mjs",
		".agents/skills/pfd-ops/scripts/check-install-sync.mjs",
	];
	const FOREIGN_ARGV_GUARDS = [
		"scripts/lib/delegation-guard.mjs",
		"scripts/lib/main-commit-guard.mjs",
	];

	// Its lookup decides what the error says, not what the script does: the
	// hint has to run ahead of the strict parse or --force reads as a plain
	// unknown option and the pointer to its replacements is lost (#631).
	it("lets both check-install-sync mirrors keep the pre-parse deprecation hint", () => {
		const source = `if (argv.some((arg) => arg === "--force" || arg.startsWith("--force="))) {`;
		for (const file of CHECK_INSTALL_SYNC_MIRRORS) {
			assert.deepEqual(findCliConventionViolations(source, file), []);
		}
		assert.equal(
			findCliConventionViolations(source, "scripts/other.mjs").length,
			1,
		);
	});

	// Exempting the whole file would take its entrypoint check out of the net,
	// and that is the shape #707 was about.
	it("still checks the exempt file's entrypoint detection", () => {
		const source =
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source under test, not an interpolation
			"if (import.meta.url === `file://${process.argv[1]}`) main();";
		for (const file of CHECK_INSTALL_SYNC_MIRRORS) {
			assert.equal(findCliConventionViolations(source, file).length, 1);
		}
	});

	it("exempts foreign-argv guard flag lookups without exempting entrypoints", () => {
		const flagLookup = `if (token.startsWith("--work-tree=")) {}`;
		const entrypoint =
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source under test, not an interpolation
			"if (import.meta.url === `file://${process.argv[1]}`) main();";
		for (const file of FOREIGN_ARGV_GUARDS) {
			assert.deepEqual(findCliConventionViolations(flagLookup, file), []);
			assert.equal(findCliConventionViolations(entrypoint, file).length, 1);
		}
	});
});
