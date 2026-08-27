import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { RELEASE_GATE_DEFINITIONS, runReleaseGates } from "./release-gates.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("release gate registry", () => {
	it("enumerates the release-only gates in release order", () => {
		assert.deepEqual(
			RELEASE_GATE_DEFINITIONS.map(({ id }) => id),
			["distribution-review", "asset-sweep", "spec-history"],
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
			["distribution-review", "asset-sweep", "spec-history"],
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
