import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	runCriteriaJudgeabilityCheck,
	usesLatestOnlyVersionQuery,
} from "./criteria-judgeability.mjs";

describe("usesLatestOnlyVersionQuery", () => {
	it("flags npm show with the singular version accessor", () => {
		assert.equal(
			usesLatestOnlyVersionQuery(
				"npm show @pfdsl/cli version が期待バージョンを返す",
			),
			true,
		);
	});

	it("flags npm view with the singular version accessor", () => {
		assert.equal(
			usesLatestOnlyVersionQuery("npm view @pfdsl/core version を返す"),
			true,
		);
	});

	it("accepts npm view with the versions list accessor", () => {
		assert.equal(
			usesLatestOnlyVersionQuery(
				"npm view @pfdsl/cli versions に 0.0.9 が含まれる",
			),
			false,
		);
	});

	it("accepts vsce show when it reads the versions list", () => {
		assert.equal(
			usesLatestOnlyVersionQuery(
				"npx @vscode/vsce show takasek.pfdsl --json の versions に 0.0.14 が含まれる",
			),
			false,
		);
	});

	it("flags vsce show when it reads the singular version", () => {
		assert.equal(
			usesLatestOnlyVersionQuery(
				"npx @vscode/vsce show takasek.pfdsl --json の version が期待バージョンを返す",
			),
			true,
		);
	});

	it("ignores criteria that name no version query", () => {
		assert.equal(
			usesLatestOnlyVersionQuery("check/fmt/graph が全サンプルにエラーなし"),
			false,
		);
	});

	// The subset this check claims is "criteria that name a command". A criteria
	// that asserts a version without naming any command is undecidable for a
	// different reason, and no predicate over command strings reaches it.
	it("ignores a version assertion that names no command", () => {
		assert.equal(
			usesLatestOnlyVersionQuery(
				"Marketplace の takasek.pfdsl version が期待バージョンを返す",
			),
			false,
		);
	});
});

function deps(overrides = {}) {
	return {
		listFiles: () => [],
		readFile: () => "",
		analyzeFile: () => ({ frontmatter: {} }),
		...overrides,
	};
}

function withNodes({ artifact = {}, process = {} }) {
	return { frontmatter: { artifact, process } };
}

describe("runCriteriaJudgeabilityCheck", () => {
	it("passes when there are no .pfdsl files", () => {
		const result = runCriteriaJudgeabilityCheck(deps());
		assert.equal(result.exitCode, 0);
		assert.deepEqual(result.stdoutLines, [
			"check-criteria-judgeability: all passed",
		]);
	});

	it("flags an artifact whose criteria uses a latest-only version query", () => {
		const result = runCriteriaJudgeabilityCheck(
			deps({
				listFiles: () => [".pfdsl/workflow.pfdsl"],
				analyzeFile: () =>
					withNodes({
						artifact: {
							published_cli: {
								criteria: "npm show @pfdsl/cli version が期待バージョンを返す",
							},
						},
					}),
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(
			result.stderrLines[0],
			/\.pfdsl\/workflow\.pfdsl: published_cli/,
		);
		assert.match(result.stderrLines.at(-1), /1 error\(s\)/);
	});

	it("scans process nodes too", () => {
		const result = runCriteriaJudgeabilityCheck(
			deps({
				listFiles: () => [".pfdsl/roadmap.pfdsl"],
				analyzeFile: () =>
					withNodes({
						process: {
							publish_cli: {
								criteria: "npm view @pfdsl/cli version を返す",
							},
						},
					}),
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /publish_cli/);
	});

	it("passes when the criteria reads the versions list", () => {
		const result = runCriteriaJudgeabilityCheck(
			deps({
				listFiles: () => [".pfdsl/roadmap.pfdsl"],
				analyzeFile: () =>
					withNodes({
						artifact: {
							cli_release: {
								criteria: "npm view @pfdsl/cli versions に 0.0.9 が含まれる",
							},
						},
					}),
			}),
		);
		assert.equal(result.exitCode, 0);
	});

	it("skips nodes with no criteria", () => {
		const result = runCriteriaJudgeabilityCheck(
			deps({
				listFiles: () => [".pfdsl/roadmap.pfdsl"],
				analyzeFile: () => withNodes({ artifact: { spec: { label: "spec" } } }),
			}),
		);
		assert.equal(result.exitCode, 0);
	});

	// A .pfdsl the parser cannot read must be reported as this check's own
	// finding. Letting the throw escape aborts the whole check-docs run with a
	// stack trace, which names neither the file nor the check.
	it("reports an unparsable file instead of throwing", () => {
		const result = runCriteriaJudgeabilityCheck(
			deps({
				listFiles: () => [".pfdsl/broken.pfdsl"],
				analyzeFile: () => {
					throw new Error("unexpected token");
				},
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines[0], /broken\.pfdsl/);
		assert.match(result.stderrLines[0], /unexpected token/);
	});

	it("keeps scanning the files after an unparsable one", () => {
		const result = runCriteriaJudgeabilityCheck(
			deps({
				listFiles: () => [".pfdsl/broken.pfdsl", ".pfdsl/ok.pfdsl"],
				analyzeFile: (text) => {
					if (text === "broken") throw new Error("unexpected token");
					return withNodes({
						artifact: {
							pkg: { criteria: "npm show @pfdsl/core version を返す" },
						},
					});
				},
				readFile: (file) => (file.includes("broken") ? "broken" : "ok"),
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines.at(-1), /2 error\(s\)/);
		assert.match(result.stderrLines[1], /ok\.pfdsl: pkg/);
	});

	it("counts findings across several files", () => {
		const result = runCriteriaJudgeabilityCheck(
			deps({
				listFiles: () => [".pfdsl/a.pfdsl", ".pfdsl/b.pfdsl"],
				analyzeFile: () =>
					withNodes({
						artifact: {
							pkg: { criteria: "npm show @pfdsl/core version を返す" },
						},
					}),
			}),
		);
		assert.equal(result.exitCode, 1);
		assert.match(result.stderrLines.at(-1), /2 error\(s\)/);
	});
});
