import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { cycleStatusExitCode, runCycleStatus } from "./cycle-status-steps.mjs";

function preflight({
	issues = [1208],
	best = null,
	roadmap = "",
	fail = [],
} = {}) {
	const reads = [];
	const deps = {
		root: "/repo",
		base: "main",
		issueNumbers: issues,
		sh: (_file, args) => {
			if (args.includes("ready"))
				return JSON.stringify({
					ok: true,
					ready: [],
					best: best ? { id: best } : null,
				});
			if (args.includes("neighbors"))
				return JSON.stringify({
					successors: [{ id: "output", kind: "primary" }],
				});
			return "";
		},
		shTry: () => ({ ok: true, out: "", status: 0 }),
		existsSync: () => true,
		readFileSync: () => roadmap,
		githubOps: {
			listOpenPrs: async () => [],
			viewIssue: async ({ number, fields }) => {
				reads.push({ number, fields });
				if (fail.includes(number)) throw new Error(`cannot read #${number}`);
				return {
					body: "設計未確定\n## Options\n1. A\n2. B",
					comments: [
						{ body: "設計記録形式: 3\n決定: incomplete", createdAt: "invalid" },
						{ body: "自由な構成の設計記録。承認は元の対話を参照。" },
					],
					labels: [{ name: "flow:exempt" }],
				};
			},
			designRecordEditInfo: async () =>
				assert.fail("must not request record edit history"),
		},
	};
	return { deps, reads };
}

function assertNoRecordVerdict(result) {
	for (const key of [
		"designUnsettledFor",
		"designUnsettledError",
		"designRecordTemplate",
	])
		assert.equal(key in result, false, key);
	assert.doesNotMatch(
		JSON.stringify(result),
		/recordRequired|optionCount|record-posted|record-incomplete/,
	);
	assert.match(result.manualChecks.join("\n"), /Before starting/);
	assert.match(
		result.manualChecks.join("\n"),
		/\.pfdsl\/bindings\/pfd-ops\.md/,
	);
}

describe("cycle preflight routes issue records to human review", () => {
	it("points manual design review to an existing pfd-ops binding heading", async () => {
		const { deps } = preflight();
		const result = await runCycleStatus(deps);
		const manualCheck = result.manualChecks.join("\n");
		const reference = manualCheck.match(
			/follow (.+?) in (\.pfdsl\/bindings\/pfd-ops\.md)/,
		);
		assert.ok(reference, "manual check must name the binding heading");
		const binding = readFileSync(reference[2], "utf8");
		assert.ok(
			binding
				.split("\n")
				.some(
					(line) =>
						/^#{2,6} /.test(line) &&
						line.replace(/^#{2,6} /, "") === reference[1],
				),
			`manual check references missing pfd-ops binding heading: ${reference[1]}`,
		);
	});

	for (const issues of [[1208], [1208, 1221]]) {
		it(`retains all explicit targets (${issues}) without classifying their prose`, async () => {
			const { deps, reads } = preflight({ issues });
			const result = await runCycleStatus(deps);
			assert.deepEqual(
				result.issueTargets,
				issues.map((issue) => ({ issue, source: "flag" })),
			);
			assert.deepEqual(
				reads.map(({ number }) => number),
				issues,
			);
			assert.ok(
				reads.every(
					({ fields }) =>
						fields.includes("comments") && fields.includes("body"),
				),
			);
			assert.equal(cycleStatusExitCode(result), 0);
			for (const issue of issues)
				assert.ok(result.gateCheckCommand.includes(`--issue ${issue}`));
			assertNoRecordVerdict(result);
		});
	}

	it("resolves the best process when no issue is specified", async () => {
		const { deps, reads } = preflight({
			issues: [],
			best: "develop",
			roadmap:
				"process:\n  develop:\n    location: https://github.com/takasek/pfdsl/issues/42\nartifact:\n",
		});
		const result = await runCycleStatus(deps);
		assert.deepEqual(result.issueTargets, [
			{ issue: 42, source: "best-process" },
		]);
		assert.deepEqual(
			reads.map(({ number }) => number),
			[42],
		);
		assert.match(result.gateCheckCommand, /--issue 42/);
		assertNoRecordVerdict(result);
	});

	for (const best of [null, "unresolved"]) {
		it(`reports an unresolved target (${best}) without claiming review completion`, async () => {
			const { deps, reads } = preflight({ issues: [], best });
			const result = await runCycleStatus(deps);
			assert.deepEqual(result.issueTargets, []);
			assert.deepEqual(reads, []);
			assert.match(result.issueError, /no .*issue|no --issue/);
			assert.equal(result.gateCheckCommand, null);
			assertNoRecordVerdict(result);
		});
	}

	it("keeps lookup failures blocking and retains the other explicit targets", async () => {
		const { deps, reads } = preflight({ issues: [1208, 1221], fail: [1208] });
		const result = await runCycleStatus(deps);
		assert.deepEqual(
			result.issueTargets,
			[1208, 1221].map((issue) => ({ issue, source: "flag" })),
		);
		assert.deepEqual(
			reads.map(({ number }) => number),
			[1208, 1221],
		);
		assert.deepEqual(result.issueLookupFailures, [
			{ issue: 1208, error: "cannot read #1208" },
		]);
		assert.equal(cycleStatusExitCode(result), 1);
		assertNoRecordVerdict(result);
	});
});
