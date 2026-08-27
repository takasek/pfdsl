/**
 * The release-only gates and their shared runner.
 *
 * Build, test, check-docs, and generated-plugin identity remain release checks, but are intentionally not in this registry: they are continuously covered elsewhere and are not publishing work left pending.
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
	repoDeps as assetSweepRepoDeps,
	runAssetSweepCheck,
} from "./asset-sweep.mjs";
import {
	repoDeps as distributionReviewRepoDeps,
	RECORD_PATH,
	runDistributionReviewCheck,
} from "./distribution-review.mjs";
import {
	formatAssetSweepStatus,
	formatDistributionReviewStatus,
	formatFullReviewStatus,
	formatSpecHistoryStatus,
	latestFullReviewDate,
} from "./release-status-check.mjs";
import { tryRun } from "./run-exec.mjs";
import {
	runSpecHistoryCheck,
	repoDeps as specHistoryRepoDeps,
} from "./spec-history-check.mjs";

const statusLines = (line) => line.split("\n");

function distributionReviewGate(root, mode, exec) {
	if (mode === "release") {
		const result = exec(
			process.execPath,
			[resolve(root, "scripts/check-distribution-review.mjs")],
			{ cwd: root, captureStderr: true },
		);
		return { ok: result.ok, message: result.out.trim() };
	}

	const deps = distributionReviewRepoDeps(root);
	const result = runDistributionReviewCheck(deps);
	const logDir = resolve(root, dirname(RECORD_PATH));
	const status = {
		record: deps.readRecord() ?? { commit: null },
		// undefined means the gate could not inspect the recorded commit. It is deliberately not converted to zero, because the gate fails closed.
		unreviewedCount: result.files?.length,
		blockedReason: result.files === undefined ? result.message : null,
		lastFullReview: latestFullReviewDate(
			existsSync(logDir) ? readdirSync(logDir) : [],
		),
	};
	return { ...result, status };
}

/**
 * The only enumeration of release-only gate definitions. `format` turns each gate's native result into the common `{ok, lines}` shape consumed by both release entry points.
 */
export const RELEASE_GATE_DEFINITIONS = [
	{
		id: "distribution-review",
		run: distributionReviewGate,
		format: (result, mode) => {
			if (mode === "release") {
				return { ok: result.ok, lines: statusLines(result.message) };
			}
			const lines = [
				formatDistributionReviewStatus(result.status),
				formatFullReviewStatus(result.status.lastFullReview),
			];
			const warnings = result.status.blockedReason
				? [`warn: ${result.status.blockedReason}`]
				: [];
			return { ok: result.ok, lines, warnings };
		},
	},
	{
		id: "asset-sweep",
		run: (root) => runAssetSweepCheck(assetSweepRepoDeps(root)),
		format: (result, mode) => ({
			ok: result.ok,
			lines:
				mode === "release"
					? statusLines(result.message)
					: statusLines(formatAssetSweepStatus(result.evaluations)),
		}),
	},
	{
		id: "spec-history",
		run: (root) => runSpecHistoryCheck(specHistoryRepoDeps(root)),
		format: (result, mode) => ({
			ok: result.ok,
			lines: statusLines(
				mode === "release" ? result.message : formatSpecHistoryStatus(result),
			),
		}),
	},
];

/**
 * Run every release-only gate in the established release order.
 * @param {string} root repository root
 * @param {{mode?: "release" | "status", stopOnFailure?: boolean, definitions?: Array<{id: string, run: Function, format: Function}>, exec?: Function}} [options]
 * @returns {Array<{id: string, ok: boolean, lines: string[], warnings?: string[]}>}
 */
export function runReleaseGates(
	root,
	{
		mode = "status",
		stopOnFailure = false,
		definitions = RELEASE_GATE_DEFINITIONS,
		exec = tryRun,
	} = {},
) {
	const results = [];
	for (const gate of definitions) {
		const result = gate.run(root, mode, exec);
		const normalized = { id: gate.id, ...gate.format(result, mode) };
		results.push(normalized);
		if (stopOnFailure && !normalized.ok) break;
	}
	return results;
}
