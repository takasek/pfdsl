import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { dropVersionHistory } from "./skill-spec-version-history.mjs";

const SPEC_FIXTURE = `# PFDSL仕様書 v0.0.17

## 19. 条件分岐の不在

条件的な結果は決定成果物として外化する。

---

## 20. バージョン

本節はバージョンごとの変更履歴を記す。

v0.0.16 からの主な変更点（v0.0.17）：CLI コマンド体系を再編した（#480）。
`;

describe("dropVersionHistory", () => {
	it("removes the バージョン section and its preceding divider", () => {
		const out = dropVersionHistory(SPEC_FIXTURE);
		assert.ok(!out.includes("## 20. バージョン"));
		assert.ok(!out.includes("CLI コマンド体系を再編した"));
		assert.ok(out.includes("## 19. 条件分岐の不在"));
		assert.ok(out.includes("条件的な結果は決定成果物として外化する。"));
	});

	it("leaves no trailing divider dangling after the cut", () => {
		const out = dropVersionHistory(SPEC_FIXTURE);
		assert.ok(!out.trimEnd().endsWith("---"));
	});

	it("returns the source unchanged when no バージョン heading is found", () => {
		const src = "# PFDSL仕様書 v9.9.9\n\nbody without a version section\n";
		assert.equal(dropVersionHistory(src), src);
	});
});
