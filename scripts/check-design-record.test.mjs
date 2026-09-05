import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { classifyDesignRecordRequiredFormat } from "./lib/gate-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/check-design-record.mjs");
const validBody = [
	"設計記録形式: 3",
	"決定:",
	"- 保存方式（実装）: Aを段階導入する",
	"理由:",
	"- 保存方式: 障害範囲を限定できる",
	"案の処分:",
	"- 部分採用 — 元候補「A」— 採用部分: 索引; 残部: 保留 — 負荷計測後に再検討",
	"前提検査 P1:",
	"対象: 保存方式 / A",
	"前提: 保存方式と通知方式を同時に変える必要がある",
	"前提を外した案: 保存方式だけを段階導入する",
	"既存候補との差分: 元候補は両方式を一組としていた",
	"検査案の処分 P1: 採用 — 今回の決定に含める",
	"改訂履歴:",
	"- なし",
].join("\n");
const malformedBody = validBody.replace("理由:", "理由");

let draftDir;

beforeEach(() => {
	draftDir = mkdtempSync(join(tmpdir(), "check-design-record-"));
});

afterEach(() => {
	rmSync(draftDir, { recursive: true, force: true });
});

describe("check-design-record", () => {
	it("reports a missing --file argument as an argument error", () => {
		const result = spawnSync(process.execPath, [script], {
			cwd: root,
			encoding: "utf8",
		});

		assert.equal(result.status, 2, result.stdout);
		assert.match(result.stderr, /^check-design-record:/);
	});

	it("reports an unknown flag as an argument error", () => {
		const result = spawnSync(process.execPath, [script, "--unknown"], {
			cwd: root,
			encoding: "utf8",
		});

		assert.equal(result.status, 2, result.stdout);
		assert.match(result.stderr, /^check-design-record:/);
	});

	it("reports a nonexistent draft path as an argument error", () => {
		const result = spawnSync(
			process.execPath,
			[script, "--file", join(draftDir, "missing.md")],
			{ cwd: root, encoding: "utf8" },
		);

		assert.equal(result.status, 2, result.stdout);
		assert.match(result.stderr, /^check-design-record:/);
	});

	for (const [name, body] of [
		["valid draft", validBody],
		["malformed draft", malformedBody],
	]) {
		it(`returns the same format verdict as the posted-record classifier for a ${name}`, () => {
			const draft = join(draftDir, "design-record.md");
			writeFileSync(draft, body);
			const result = spawnSync(process.execPath, [script, "--file", draft], {
				cwd: root,
				encoding: "utf8",
			});
			const expected = classifyDesignRecordRequiredFormat(
				body,
				new Date().toISOString(),
			);

			assert.equal(
				result.status,
				expected.status === "FAIL" ? 1 : 0,
				result.stderr,
			);
			assert.match(
				result.stdout,
				new RegExp(`check-design-record: ${expected.status}`),
			);
			if (expected.detail) assert.ok(result.stdout.includes(expected.detail));
		});
	}

	it("fails on a malformed draft and passes after it is fixed", () => {
		const draft = join(draftDir, "design-record.md");
		writeFileSync(draft, malformedBody);
		const failed = spawnSync(process.execPath, [script, "--file", draft], {
			cwd: root,
			encoding: "utf8",
		});

		assert.equal(failed.status, 1, failed.stderr);
		assert.match(failed.stdout, /check-design-record: FAIL/);
		assert.match(failed.stdout, /理由:/);

		writeFileSync(draft, validBody);
		const passed = spawnSync(process.execPath, [script, "--file", draft], {
			cwd: root,
			encoding: "utf8",
		});

		assert.equal(passed.status, 0, passed.stderr);
		assert.match(passed.stdout, /check-design-record: PASS/);
	});
});
