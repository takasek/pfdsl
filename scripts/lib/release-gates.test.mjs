import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RELEASE_GATE_DEFINITIONS, runReleaseGates } from "./release-gates.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("release gate registry", () => {
	it("enumerates the release-only gates in release order", () => {
		assert.deepEqual(
			RELEASE_GATE_DEFINITIONS.map(({ id }) => id),
			["distribution-review", "spec-history", "migration-guide"],
		);
		for (const gate of RELEASE_GATE_DEFINITIONS) {
			assert.equal(typeof gate.run, "function");
			assert.equal(typeof gate.format, "function");
		}
	});

	it("normalizes every registered gate to the common result shape", () => {
		const results = runReleaseGates(root, { mode: "status" });

		assert.deepEqual(
			results.map(({ id }) => id),
			["distribution-review", "spec-history", "migration-guide"],
		);
		for (const result of results) {
			assert.equal(typeof result.ok, "boolean");
			assert.ok(Array.isArray(result.lines));
			assert.ok(result.lines.length > 0);
		}
	});

	it("stops release checks at the first failed gate", () => {
		const ran = [];
		const definitions = [
			{
				id: "first",
				run: () => {
					ran.push("first");
					return { ok: false, message: "first failed" };
				},
				format: (result) => ({ ok: result.ok, lines: [result.message] }),
			},
			{
				id: "second",
				run: () => {
					ran.push("second");
					return { ok: true, message: "second passed" };
				},
				format: (result) => ({ ok: result.ok, lines: [result.message] }),
			},
		];

		assert.deepEqual(
			runReleaseGates(root, {
				mode: "release",
				stopOnFailure: true,
				definitions,
			}),
			[{ id: "first", ok: false, lines: ["first failed"] }],
		);
		assert.deepEqual(ran, ["first"]);
	});

	it("keeps the release message unadorned while status adds its marker", () => {
		const specHistory = RELEASE_GATE_DEFINITIONS.find(
			({ id }) => id === "spec-history",
		);
		const result = {
			ok: true,
			message: "docs/spec/spec-history.md's top entry documents v0.0.20.",
		};

		assert.deepEqual(specHistory.format(result, "release"), {
			ok: true,
			lines: [result.message],
		});
		assert.deepEqual(specHistory.format(result, "status"), {
			ok: true,
			lines: [`  spec-history (docs/spec/spec-history.md) ✓ ${result.message}`],
		});
	});

	it("runs distribution review in release mode through its checker subprocess", () => {
		const calls = [];
		const result = runReleaseGates(root, {
			mode: "release",
			stopOnFailure: true,
			exec: (file, args, options) => {
				calls.push({ file, args, options });
				return { ok: false, out: "subprocess failed", status: 1 };
			},
		});

		assert.deepEqual(calls, [
			{
				file: process.execPath,
				args: [resolve(root, "scripts/check-distribution-review.mjs")],
				options: { cwd: root, captureStderr: true },
			},
		]);
		assert.deepEqual(result[0], {
			id: "distribution-review",
			ok: false,
			lines: ["subprocess failed"],
		});
	});

	it("captures checker stderr before printing each failure message once", () => {
		const result = runReleaseGates(root, {
			mode: "release",
			stopOnFailure: true,
			exec: (_file, _args, options) => {
				assert.equal(options.captureStderr, true);
				return {
					ok: false,
					out: "Distribution review failed on stderr.",
					status: 1,
				};
			},
		});

		assert.deepEqual(result[0].lines, [
			"Distribution review failed on stderr.",
		]);
		assert.equal(
			result[0].lines.join("\n").match(/Distribution review failed/g).length,
			1,
		);
	});
});

describe("migration-guide gate", () => {
	const HEADING = "## Unreleased — after CLI/plugin v0.0.26";
	const WORKFLOW_LINK = ".pfdsl/workflow.md#採用先への移行案内";
	const gate = RELEASE_GATE_DEFINITIONS.find(
		({ id }) => id === "migration-guide",
	);

	function withGuide(guideText, body) {
		const dir = mkdtempSync(join(tmpdir(), "release-gates-guide-"));
		try {
			mkdirSync(join(dir, "docs"));
			writeFileSync(join(dir, "docs/migration-guide.md"), guideText);
			return body(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	const runOnly = (dir, options) =>
		runReleaseGates(dir, { definitions: [gate], ...options })[0];

	const pendingGuide = `# Migration guide\n\n${HEADING}\n\nbody\n`;
	const assignedGuide = "# Migration guide\n\n## CLI/plugin v0.0.27\n\nbody\n";

	it("blocks a CLI/plugin release while the guide still has an Unreleased section", () => {
		withGuide(pendingGuide, (dir) => {
			const result = runOnly(dir, { mode: "release", kind: "cli" });

			assert.equal(result.ok, false);
			const message = result.lines.join("\n");
			assert.ok(message.includes(HEADING), message);
			assert.match(message, /assign the destination release/);
			assert.ok(message.includes(WORKFLOW_LINK), message);
		});
	});

	it("does not block library or VS Code releases on a CLI/plugin Unreleased section", () => {
		withGuide(pendingGuide, (dir) => {
			for (const kind of ["libs", "vscode"]) {
				const result = runOnly(dir, { mode: "release", kind });

				assert.equal(result.ok, true, kind);
				assert.ok(result.lines.length > 0);
			}
		});
	});

	it("passes a CLI/plugin release once the section has been assigned", () => {
		withGuide(assignedGuide, (dir) => {
			assert.equal(runOnly(dir, { mode: "release", kind: "cli" }).ok, true);
		});
	});

	it("refuses a release-mode run that does not say which release it is", () => {
		withGuide(assignedGuide, (dir) => {
			assert.throws(() => runOnly(dir, { mode: "release" }), /release kind/);
		});
	});

	it("reports the pending section in status without failing it", () => {
		withGuide(pendingGuide, (dir) => {
			const result = runOnly(dir, { mode: "status" });

			assert.equal(result.ok, true);
			const message = result.lines.join("\n");
			assert.ok(message.includes(HEADING), message);
			assert.ok(message.includes(WORKFLOW_LINK), message);
		});
	});

	it("reports a clean guide in status", () => {
		withGuide(assignedGuide, (dir) => {
			const result = runOnly(dir, { mode: "status" });

			assert.equal(result.ok, true);
			assert.match(
				result.lines.join("\n"),
				/no CLI\/plugin Unreleased section/,
			);
		});
	});

	it("hands the release kind to every gate", () => {
		const seen = [];
		runReleaseGates(root, {
			mode: "release",
			kind: "libs",
			definitions: [
				{
					id: "probe",
					run: (_root, mode, _exec, kind) => {
						seen.push({ mode, kind });
						return { ok: true };
					},
					format: (result) => ({ ok: result.ok, lines: ["probe"] }),
				},
			],
		});

		assert.deepEqual(seen, [{ mode: "release", kind: "libs" }]);
	});
});
