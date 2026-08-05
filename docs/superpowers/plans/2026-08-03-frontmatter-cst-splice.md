# frontmatter CST 書き込みのバイト範囲スプライス化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `meta set` / `reindex` / `insert-definition` / `sort` が無関係なフィールドを書き換えるとき、`description: >` のような折り返し済み複数行スカラーが1行に潰れる不具合を、対象箇所だけをバイト単位でスプライスする方式に置き換えて根絶する。

**Architecture:** `packages/core/src/frontmatter-cst.ts` に `applySplices` プリミティブと、既存ノードの `range`（元ソースのバイトオフセット）を使って「変更したい箇所だけ」の置換テキストを計算する splice ヘルパー群を追加する。4つの呼び出し元（`setFrontmatterField` / `reindex.ts` / `insert-definition.ts` / `sort.ts`）はこれらのヘルパーを使い、`Document#toString()` による全文再直列化を経由せずに元テキストへ直接スプライスする。触っていないバイトは一切再直列化されないため、折り返し位置・コメント位置・インデント幅が無条件で温存される。

**Tech Stack:** TypeScript, `yaml` パッケージ（`parseDocument`, `Document`, `range`）, vitest。

## Global Constraints

- 設計は `docs/superpowers/specs/2026-08-03-frontmatter-cst-splice-design.md` に確定済み。
- `fmt`（`packages/core/src/index.ts` の `format()`）は対象外 — `renderFrontmatterCst` 全文再直列化のまま変更しない。
- 対象フィールドが anchor/alias を参照する場合は全文再直列化にフォールバックする（スコープ外、壊さないことだけ保証）。
- `insert-definition.test.ts` の「4スペースインデント正規化」「ヘッダ末尾コメント移動」の2件は、期待値を「元の書式を保持する」方向に更新する（意図的な仕様変更、設計doc参照）。
- 既存の公開関数シグネチャ（`setFrontmatterField`, `reindex`, `insertDefinition`, `sort` の引数・返り値の型）は変更しない。
- コミットメッセージは英語。t-wada式 TDD（Red→Green→Refactor）、論理単位ごとにコミット。

---

### Task 1: `applySplices` プリミティブ

**Files:**
- Modify: `packages/core/src/frontmatter-cst.ts`
- Test: `packages/core/src/frontmatter-cst.test.ts`

**Interfaces:**
- Produces: `export interface Splice { start: number; end: number; replacement: string }`、`export function applySplices(text: string, splices: Splice[]): string`。後続タスク全てがこれを使う。

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/frontmatter-cst.test.ts` の末尾に追加:

```ts
import { applySplices } from "./frontmatter-cst.js";

describe("applySplices", () => {
	it("replaces a single range", () => {
		expect(applySplices("hello world", [{ start: 6, end: 11, replacement: "there" }])).toBe(
			"hello there",
		);
	});

	it("applies multiple non-overlapping splices regardless of input order", () => {
		const text = "aaa bbb ccc";
		const out = applySplices(text, [
			{ start: 8, end: 11, replacement: "ZZZ" },
			{ start: 0, end: 3, replacement: "XXX" },
		]);
		expect(out).toBe("XXX bbb ZZZ");
	});

	it("supports pure insertion (start === end)", () => {
		expect(applySplices("ab", [{ start: 1, end: 1, replacement: "-" }])).toBe("a-b");
	});

	it("throws on overlapping splices", () => {
		expect(() =>
			applySplices("abcdef", [
				{ start: 0, end: 3, replacement: "X" },
				{ start: 2, end: 5, replacement: "Y" },
			]),
		).toThrow(/overlap/);
	});
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd packages/core && npx vitest run src/frontmatter-cst.test.ts -t applySplices`
Expected: FAIL — `applySplices` is not exported.

- [ ] **Step 3: 最小実装**

`packages/core/src/frontmatter-cst.ts` の末尾に追加:

```ts
export interface Splice {
	start: number;
	end: number;
	replacement: string;
}

/**
 * Apply non-overlapping byte-range replacements to `text` in one pass.
 * Splice order in the input array doesn't matter — they're sorted by
 * `start` before applying. Used by every write path in this file to touch
 * only the bytes an operation actually changed, leaving everything else
 * (comments, folded-scalar line wraps, indentation) byte-identical.
 */
export function applySplices(text: string, splices: Splice[]): string {
	const sorted = [...splices].sort((a, b) => a.start - b.start);
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i].start < sorted[i - 1].end) {
			throw new Error("applySplices: overlapping splices");
		}
	}
	let out = "";
	let cursor = 0;
	for (const s of sorted) {
		out += text.slice(cursor, s.start) + s.replacement;
		cursor = s.end;
	}
	return out + text.slice(cursor);
}
```

- [ ] **Step 4: 通過を確認**

Run: `cd packages/core && npx vitest run src/frontmatter-cst.test.ts -t applySplices`
Expected: PASS (4 tests)

- [ ] **Step 5: コミット**

```bash
git add packages/core/src/frontmatter-cst.ts packages/core/src/frontmatter-cst.test.ts
git commit -m "feat(core): add applySplices primitive for byte-range frontmatter edits"
```

---

### Task 2: `parseFrontmatterCst` が `yamlText` を返すよう拡張

splice はフェンス内の生テキスト（`yamlText`）に対してオフセットを取るため、呼び出し元がこれを直接参照できる必要がある。現状 `parseFrontmatterCst` は内部で `yamlText` を計算した後、`parseDocument(yamlText)` の結果だけを返し `yamlText` 自体を捨てている。

**Files:**
- Modify: `packages/core/src/frontmatter-cst.ts`
- Test: `packages/core/src/frontmatter-cst.test.ts`

**Interfaces:**
- Consumes: なし（既存関数の戻り値を拡張するだけ）
- Produces: `FrontmatterCst.yamlText: string` — present:true の時、フェンス内のYAMLテキスト（最終行の末尾改行を含まない、#644 と同じ切り出し）。present:false の時は `""`。

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe("parseFrontmatterCst yamlText", () => {
	it("exposes the raw yaml text between the fences", () => {
		const src = "---\nartifact:\n  spec:\n    status: todo\n---\na >> P -> b\n";
		const cst = parseFrontmatterCst(src);
		expect(cst.yamlText).toBe("artifact:\n  spec:\n    status: todo");
	});

	it("is empty when there is no frontmatter", () => {
		expect(parseFrontmatterCst("a >> P -> b\n").yamlText).toBe("");
	});
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd packages/core && npx vitest run src/frontmatter-cst.test.ts -t "parseFrontmatterCst yamlText"`
Expected: FAIL — `cst.yamlText` is `undefined`.

- [ ] **Step 3: 実装**

`packages/core/src/frontmatter-cst.ts` の `FrontmatterCst` interface と `parseFrontmatterCst` を変更:

```ts
export interface FrontmatterCst {
	present: boolean;
	doc: Document;
	body: string;
	newline: "\n" | "\r\n";
	/**
	 * The raw YAML text between the fences, exactly as sliced for
	 * `parseDocument` (same #644 trailing-\r handling). Never carries its
	 * own trailing newline — callers that splice into it must supply the
	 * separator themselves when reassembling (see `padLine` in Task 3).
	 */
	yamlText: string;
}
```

`parseFrontmatterCst` の4箇所の `return { present: false, ... }` / 最終 `return` に `yamlText` を足す:

```ts
export function parseFrontmatterCst(source: string): FrontmatterCst {
	const newline = detectNewline(source);
	if (!source.startsWith("---")) {
		return { present: false, doc: new Document(), body: source, newline, yamlText: "" };
	}
	const firstNl = source.indexOf("\n");
	if (firstNl === -1) {
		return { present: false, doc: new Document(), body: source, newline, yamlText: "" };
	}
	let lineStart = firstNl + 1;
	let closingStart = -1;
	let closingEnd = -1;
	while (lineStart <= source.length) {
		const nl = source.indexOf("\n", lineStart);
		const lineEnd = nl === -1 ? source.length : nl;
		if (source.slice(lineStart, lineEnd).trimEnd() === "---") {
			closingStart = lineStart;
			closingEnd = lineEnd;
			break;
		}
		if (nl === -1) break;
		lineStart = nl + 1;
	}
	if (closingStart === -1) {
		return { present: false, doc: new Document(), body: source, newline, yamlText: "" };
	}
	const yamlText =
		closingStart > firstNl + 1
			? source.slice(firstNl + 1, closingStart - 1).replace(/\r$/, "")
			: "";
	const body = closingEnd === source.length ? "" : source.slice(closingEnd + 1);
	return { present: true, doc: parseDocument(yamlText), body, newline, yamlText };
}
```

- [ ] **Step 4: 通過を確認**

Run: `cd packages/core && npx vitest run src/frontmatter-cst.test.ts`
Expected: PASS（既存テスト含め全て）

- [ ] **Step 5: コミット**

```bash
git add packages/core/src/frontmatter-cst.ts packages/core/src/frontmatter-cst.test.ts
git commit -m "feat(core): expose raw yamlText from parseFrontmatterCst"
```

---

### Task 3: `setFrontmatterField` を splice 方式へ書き換え

これが今回の主題（`meta set` の不具合）を直接修正するタスク。既存の `setFrontmatterField` を全面置換する。

**Files:**
- Modify: `packages/core/src/frontmatter-cst.ts`
- Test: `packages/core/src/frontmatter-cst.test.ts`

**Interfaces:**
- Consumes: `applySplices`（Task 1）、`parseFrontmatterCst` の `yamlText`（Task 2）
- Produces:
  - `export function fieldValueSplice(yamlText: string, doc: Document, kind: NodeKind, id: string, field: string, value: string | number, newline: "\n" | "\r\n"): { ok: true; splice: Splice } | { ok: false; reason: "not-found" | "unsupported" }` — Task 4（reindex）がこれを直接再利用する。
  - `setFrontmatterField` は既存シグネチャのまま、内部実装のみ置換。

- [ ] **Step 1: 失敗するテストを書く（バグ修正の再現ケース）**

`frontmatter-cst.test.ts` の `describe("setFrontmatterField", ...)` 内に追加:

```ts
it("preserves an untouched folded-scalar sibling's line wraps (#issue)", () => {
	const src = [
		"---",
		"artifact:",
		"  foo:",
		"    label: Foo",
		"    description: >",
		"      This is a long description",
		"      that spans multiple lines",
		"      intentionally folded.",
		"    status: todo",
		"---",
		"body",
		"",
	].join("\n");
	const out = setFrontmatterField(src, "artifact", "foo", "status", "wip");
	expect(out).toBe(
		[
			"---",
			"artifact:",
			"  foo:",
			"    label: Foo",
			"    description: >",
			"      This is a long description",
			"      that spans multiple lines",
			"      intentionally folded.",
			"    status: wip",
			"---",
			"body",
			"",
		].join("\n"),
	);
});

it("inserts a missing field mid-document without duplicating the next section's newline", () => {
	const src =
		"---\nartifact:\n  spec:\n    label: Spec\nprocess:\n  p:\n    label: P\n---\na >> P -> b\n";
	const out = setFrontmatterField(src, "artifact", "spec", "owner", "alice");
	expect(out).toBe(
		"---\nartifact:\n  spec:\n    label: Spec\n    owner: alice\nprocess:\n  p:\n    label: P\n---\na >> P -> b\n",
	);
});

it("inserts a missing field under CRLF without mixing line endings", () => {
	const crlf = (...lines: string[]) => lines.join("\r\n");
	const src = crlf("---", "artifact:", "  spec:", "    label: Spec", "---", "a >> P -> b", "");
	const out = setFrontmatterField(src, "artifact", "spec", "owner", "alice");
	expect(out).toBe(
		crlf(
			"---",
			"artifact:",
			"  spec:",
			"    label: Spec",
			"    owner: alice",
			"---",
			"a >> P -> b",
			"",
		),
	);
});

it("falls back to full re-serialization for a field that is an alias reference", () => {
	const src =
		"---\ndefaults: &d\n  owner: alice\nartifact:\n  spec:\n    label: Spec\n    owner: *d\n---\na >> P -> b\n";
	const out = setFrontmatterField(src, "artifact", "spec", "owner", "bob");
	expect(out).toContain("owner: bob");
	expect(out).not.toContain("owner: *d");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd packages/core && npx vitest run src/frontmatter-cst.test.ts -t "folded-scalar sibling"`
Expected: FAIL — 現行実装は `description` を1行に潰す。

- [ ] **Step 3: 実装**

`packages/core/src/frontmatter-cst.ts` に以下を追加し、既存の `setFrontmatterField` 本体を置き換える（ファイル末尾の `export function setFrontmatterField` 全体を丸ごと以下に差し替え）:

```ts
import { Document, isAlias, isMap, isScalar, parseDocument } from "yaml";

/** The indent (leading spaces/tabs) of the line containing byte offset `pos`. */
function lineIndent(text: string, pos: number): string {
	const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
	return (text.slice(lineStart, pos).match(/^[ \t]*/) ?? [""])[0];
}

/**
 * Render `value` the way the `yaml` package would inside a map with the
 * given flow-ness, without re-serializing anything else. Quoting rules
 * differ between flow and block context (`,` and `}` are structural only
 * in flow), so the throwaway document must match the real target's flow
 * setting for the quoting decision to come out right.
 */
function renderValue(value: string | number, flow: boolean): string {
	const tmp = parseDocument(flow ? "{ y: 0 }" : "y: 0");
	tmp.setIn(["y"], value);
	const rendered = tmp.toString({ lineWidth: 0 });
	return flow
		? rendered.replace(/^\{ y: /, "").replace(/ \}\n$/, "")
		: rendered.replace(/^y: /, "").replace(/\n$/, "");
}

/**
 * Wrap `content` (a bare, unterminated new line of YAML) with whatever
 * leading/trailing newline the surrounding text is missing at `insertAt`,
 * checked against the single adjacent character. Never assumes based on
 * node type whether a boundary already has its own newline — block-map
 * and scalar `range` endpoints disagree on whether they swallow the
 * following newline, so the only reliable signal is the actual text.
 */
function padLine(yamlText: string, insertAt: number, content: string, newline: string): string {
	const before = yamlText.slice(0, insertAt);
	const afterChar = yamlText[insertAt];
	const lead = before.length > 0 && !before.endsWith("\n") ? newline : "";
	const trail = afterChar !== undefined && afterChar !== "\n" && afterChar !== "\r" ? newline : "";
	return `${lead}${content}${trail}`;
}

/**
 * Compute the byte-range splice that sets `[kind, id, field]` to `value`,
 * without touching any other byte of `yamlText`. Returns `{ ok: false }`
 * when the node's field is an alias reference (splicing just the value
 * would desync it from whatever anchor it points at) or when the parent
 * map is an empty block map (no sibling to anchor indentation on) — both
 * are rare enough that callers fall back to full re-serialization.
 */
export function fieldValueSplice(
	yamlText: string,
	doc: Document,
	kind: NodeKind,
	id: string,
	field: string,
	value: string | number,
	newline: "\n" | "\r\n",
): { ok: true; splice: Splice } | { ok: false; reason: "not-found" | "unsupported" } {
	const node = doc.getIn([kind, id], true);
	if (!isMap(node)) return { ok: false, reason: "not-found" };
	const pair = node.items.find((p) => isScalar(p.key) && p.key.value === field);
	const replacement = renderValue(value, !!node.flow);

	if (pair?.value) {
		if (isAlias(pair.value)) return { ok: false, reason: "unsupported" };
		const [start, end] = pair.value.range as [number, number, number];
		return { ok: true, splice: { start, end, replacement } };
	}

	if (node.items.length === 0) {
		if (node.flow) {
			const openBrace = (node.range as [number, number, number])[0];
			return {
				ok: true,
				splice: { start: openBrace + 1, end: openBrace + 1, replacement: ` ${field}: ${replacement}` },
			};
		}
		return { ok: false, reason: "unsupported" };
	}

	const last = node.items[node.items.length - 1];
	const insertAt = (last.value.range as [number, number, number])[1];
	if (node.flow) {
		return {
			ok: true,
			splice: { start: insertAt, end: insertAt, replacement: `, ${field}: ${replacement}` },
		};
	}
	const indent = lineIndent(yamlText, (last.key.range as [number, number, number])[0]);
	const line = padLine(yamlText, insertAt, `${indent}${field}: ${replacement}`, newline);
	return { ok: true, splice: { start: insertAt, end: insertAt, replacement: line } };
}

/**
 * Rewrite one node's field in `source`'s frontmatter, preserving everything
 * else (comments, quote style, flow-vs-block, and — unlike a full
 * `Document#toString()` round trip — the exact line-wrap positions of any
 * untouched folded/literal block scalar) byte-for-byte. Used by `meta set`
 * (ADR-0034). Quoting for the new value is left to the `yaml` package's own
 * core-schema judgment — pass a `number` for integer fields (e.g. `index`)
 * and a `string` for everything else. Returns null when there is no
 * frontmatter, or when `id` has no entry under `kind`.
 */
export function setFrontmatterField(
	source: string,
	kind: NodeKind,
	id: string,
	field: string,
	value: string | number,
): string | null {
	const { present, doc, body, newline, yamlText } = parseFrontmatterCst(source);
	if (!present || !doc.hasIn([kind, id])) return null;

	const result = fieldValueSplice(yamlText, doc, kind, id, field, value, newline);
	if (result.ok) {
		const newYamlText = applySplices(yamlText, [result.splice]);
		return `---${newline}${newYamlText}${newline}---${newline}${body}`;
	}

	// Alias reference or empty block map: nothing safe to splice, fall back
	// to the pre-existing full re-serialize path.
	doc.setIn([kind, id, field], value);
	return renderFrontmatterCst(doc, newline) + body;
}
```

`NodeKind` は既にこのファイルで import 済み（`import type { NodeKind } from "./types/index.js";`）。`isAlias` / `isMap` / `isScalar` を `yaml` からの import に追加する必要がある — ファイル冒頭の `import { Document, parseDocument } from "yaml";` を `import { Document, isAlias, isMap, isScalar, parseDocument } from "yaml";` に変更する（`Document` は `parseFrontmatterCst` 内で既に `new Document()` として値として使われているため、型only importにはできない）。

- [ ] **Step 4: 通過を確認**

Run: `cd packages/core && npx vitest run src/frontmatter-cst.test.ts`
Expected: PASS — 全テスト（既存17件 + 今回追加4件）。

- [ ] **Step 5: 型チェック**

Run: `cd packages/core && npx tsgo --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/core/src/frontmatter-cst.ts packages/core/src/frontmatter-cst.test.ts
git commit -m "fix(core): splice setFrontmatterField edits instead of full re-serialize

meta set on an unrelated field collapsed sibling folded-scalar (>)
descriptions to one line, because Document#toString() discards the
original fold's line-wrap positions even for untouched fields.
fieldValueSplice now touches only the target field's byte range."
```

---

### Task 4: `reindex.ts` を splice バッチ適用へ書き換え

**前提**: このタスクは Task 5 が追加する `newEntrySplice`（`frontmatter-cst.ts`）に依存する。**Task 5 を先に実装してから着手すること。** `reindex` は「フロントマターに全く存在しないノード」にも `index` を新規付与する必要があり（body にしか登場しないノードへの reindex は実際の主要ユースケース）、Task 3 の `fieldValueSplice` は「既存ノードの中の1フィールド」しか扱えない設計のため、これだけでは不十分。バッチの中に「既存ノードの `index` 追加/上書き」と「フロントマターに未登場のノードを丸ごと新規作成」が混在しうる。

**Files:**
- Modify: `packages/core/src/reindex.ts`
- Test: `packages/core/src/reindex.test.ts`

**Interfaces:**
- Consumes: `fieldValueSplice`（Task 3）、`newEntrySplice`（Task 5）、`applySplices`（Task 1）
- Produces: 既存の `reindex()` シグネチャは変更しない。

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/reindex.test.ts` に追加（ファイル冒頭の import に合わせて配置）。このテストは意図的に「既存ノード（`a`、折り返し済み `description` 持ち）」と「フロントマターに全く登場しない body-only ノード（`p`、`b`）」を同一バッチに混在させる — 両方の splice 経路が同時に動くことを確認するため:

```ts
it("preserves an untouched folded-scalar sibling's line wraps, even when the same batch also creates brand-new entries", () => {
	const src = [
		"---",
		"artifact:",
		"  a:",
		"    label: A",
		"    description: >",
		"      long text",
		"      wrapped here",
		"---",
		"a >> p -> b",
		"",
	].join("\n");
	const { output } = reindex(src, { renumber: true });
	expect(output).toContain("description: >\n      long text\n      wrapped here\n");
	// p (process, body-only) and b (artifact, body-only) both get a fresh
	// frontmatter entry with an index in the same pass.
	expect(output).toContain("process:\n  p:\n    index: 1");
	expect(output).toMatch(/b:\n\s*index: 2/);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd packages/core && npx vitest run src/reindex.test.ts -t "brand-new entries"`
Expected: FAIL — 現行実装は `doc.toString()` 全文再直列化を通すため折り返しが1行化される。

- [ ] **Step 3: 実装**

`packages/core/src/reindex.ts` を変更。import を追加し、書き込み部分（現状の以下のブロック）を置き換える:

```ts
	const cst = parseFrontmatterCst(source);
	const doc = cst.present ? cst.doc : new Document();
	for (const c of changes) {
		doc.setIn([c.kind, c.id, "index"], c.to);
	}
	const output = renderFrontmatterCst(doc, cst.newline) + cst.body;
	return { output, changes, diagnostics };
```

置き換え後（各変更ごとに「既存ノードなら `fieldValueSplice`、未登場ノードなら `newEntrySplice`」を振り分け、いずれか1件でも `ok:false` ならバッチ全体を安全にフォールバックする — Task 3 の設計と同じ「部分的に splice・部分的に全文再直列化」という中途半端な結果を避ける方針を踏襲）:

```ts
	const cst = parseFrontmatterCst(source);
	if (!cst.present) {
		// No frontmatter to splice into (shouldn't happen once `changes` is
		// non-empty, since every changed id came from parsed frontmatter, but
		// keep the pre-existing full-render fallback for safety).
		const doc = new Document();
		for (const c of changes) doc.setIn([c.kind, c.id, "index"], c.to);
		return { output: renderFrontmatterCst(doc, cst.newline) + cst.body, changes, diagnostics };
	}

	const splices: Splice[] = [];
	let fallbackNeeded = false;
	for (const c of changes) {
		const result = cst.doc.hasIn([c.kind, c.id])
			? fieldValueSplice(cst.yamlText, cst.doc, c.kind, c.id, "index", c.to, cst.newline)
			: newEntrySplice(cst.yamlText, cst.doc, c.kind, c.id, "index", c.to, cst.newline);
		if (!result.ok) {
			fallbackNeeded = true;
			break;
		}
		splices.push(result.splice);
	}

	if (fallbackNeeded) {
		for (const c of changes) cst.doc.setIn([c.kind, c.id, "index"], c.to);
		return { output: renderFrontmatterCst(cst.doc, cst.newline) + cst.body, changes, diagnostics };
	}

	const newYamlText = applySplices(cst.yamlText, splices);
	const output = `---${cst.newline}${newYamlText}${cst.newline}---${cst.newline}${cst.body}`;
	return { output, changes, diagnostics };
```

ファイル冒頭の import を更新:

```ts
import { Document } from "yaml";
import {
	applySplices,
	fieldValueSplice,
	newEntrySplice,
	parseFrontmatterCst,
	renderFrontmatterCst,
	type Splice,
} from "./frontmatter-cst.js";
```

`newEntrySplice` のシグネチャは Task 5 で `(yamlText, doc, kind, id, field, value, newline)` として定義される（`fieldValueSplice` と同じ引数順）。`kind` の型は `"artifact" | "process"` — `reindex` の `changes` は `NodeKind`（`group` を含みうる）なので、`c.kind` を渡す箇所は `c.kind === "group"` を弾く必要がある点に注意。既存の `reindex` は `group` ノードに `index` を割り当てる経路が元々ないか確認し（`computeTopoOrder` や `assigned` の扱いを見る限り、`group` は index 割当の対象外のはず）、対象外であることを型でも表現できるなら表現する。もし型上 `NodeKind` のまま渡さざるを得ない場合は、呼び出し直前に `c.kind !== "group"` をアサートするか、`newEntrySplice`/`fieldValueSplice` 呼び出し側で `as "artifact" | "process"` を使う（Task 3 の `fieldValueSplice` 自体は `kind: NodeKind` を受けるので `group` が来ても型エラーにはならないが、`newEntrySplice` は Task 5 で `"artifact" | "process"` に絞る設計なので、ここだけ型が食い違う可能性がある — 実装時に `tsgo` の指摘に従って調整すること）。

- [ ] **Step 4: 通過を確認**

Run: `cd packages/core && npx vitest run src/reindex.test.ts`
Expected: PASS — 既存テスト全件 + 新規1件。

- [ ] **Step 5: 型チェック**

Run: `cd packages/core && npx tsgo --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/core/src/reindex.ts packages/core/src/reindex.test.ts
git commit -m "fix(core): splice reindex's index: writes instead of full re-serialize"
```

---

### Task 5: `newEntrySplice` 共有プリミティブ + `insert-definition.ts` の書き換え

**設計変更の経緯**: 当初このタスクは `insert-definition.ts` 単体の書き換えとして計画されていたが、Task 4（`reindex.ts`）の実装中に「フロントマターに全く存在しないノードへも書き込む」という要求が `insert-definition.ts` 固有ではなく `reindex.ts` にも共通することが判明した。そのため「新規 `[kind, id]` エントリを1フィールド分だけ挿入する」ロジックを `frontmatter-cst.ts` 側の汎用プリミティブ `newEntrySplice` として切り出し、`insertDefinition`（`label` 固定）と `reindex`（`index` 固定）の両方がこれを呼ぶ形にする。Task 3 の `fieldValueSplice` が「既存ノードの中の1フィールド」を扱うのに対し、`newEntrySplice` は「`kind.id` というノード自体が存在しないとき、それを1フィールドだけ持つ形で新規作成する」ことを扱う——住み分けが異なるだけで、内部で使うヘルパー（`lineIndent`, `renderValue`, `padLine`）は Task 3 で `frontmatter-cst.ts` に追加済みのものをそのまま再利用する。

**Files:**
- Modify: `packages/core/src/frontmatter-cst.ts`（`newEntrySplice` 追加）
- Modify: `packages/core/src/insert-definition.ts`（`newEntrySplice` を使う薄いラッパーへ置き換え）
- Test: `packages/core/src/frontmatter-cst.test.ts`（`newEntrySplice` の直接テスト）
- Test: `packages/core/src/insert-definition.test.ts`（既存2件の期待値更新 + 回帰確認）

**Interfaces:**
- Consumes: `applySplices`（Task 1）、`parseFrontmatterCst` の `yamlText`（Task 2）、`lineIndent` / `renderValue` / `padLine`（Task 3 で `frontmatter-cst.ts` に追加済み、re-export 不要・同一ファイル内での再利用）
- Produces: `export function newEntrySplice(yamlText: string, doc: Document, kind: "artifact" | "process", id: string, field: string, value: string | number, newline: "\n" | "\r\n"): { ok: true; splice: Splice } | { ok: false; reason: "unsupported" }` — Task 4（`reindex`）がこれを直接再利用する。既存の `insertDefinition()` シグネチャは変更しない。

#### Part A: `newEntrySplice` を `frontmatter-cst.ts` に追加

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/frontmatter-cst.test.ts` に追加。`newEntrySplice` は低レベルプリミティブなので、ここでは戻り値の `splice` を自分で `applySplices` に通した結果を検証する（`insertDefinition`/`reindex` 経由の統合テストは Part B・Task 4 で別途行う）:

```ts
import { newEntrySplice } from "./frontmatter-cst.js";

describe("newEntrySplice", () => {
	it("appends a new entry after the last sibling in a non-empty block section", () => {
		const yamlText = "artifact:\n  a:\n    label: A\nprocess:\n  p:\n    label: P";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(yamlText, doc, "artifact", "b", "label", "b", "\n");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe("artifact:\n  a:\n    label: A\n  b:\n    label: b\nprocess:\n  p:\n    label: P");
	});

	it("creates the kind section itself when it doesn't exist at all", () => {
		const yamlText = "artifact:\n  a:\n    label: A";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(yamlText, doc, "process", "p", "label", "p", "\n");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe("artifact:\n  a:\n    label: A\nprocess:\n  p:\n    label: p");
	});

	it("inserts into a flow-style section", () => {
		const yamlText = "artifact: { a: { label: A } }";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(yamlText, doc, "artifact", "b", "label", "b", "\n");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe("artifact: { a: { label: A }, b: { label: b } }");
	});

	it("supports a non-string value (index: number)", () => {
		const yamlText = "artifact:\n  a:\n    label: A";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(yamlText, doc, "artifact", "b", "index", 2, "\n");
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const out = applySplices(yamlText, [result.splice]);
		expect(out).toBe("artifact:\n  a:\n    label: A\n  b:\n    index: 2");
	});

	it("returns unsupported for an empty block-style section (no sibling to anchor on)", () => {
		const yamlText = "artifact:\nprocess:\n  p:\n    label: P";
		const doc = parseDocument(yamlText) as unknown as import("yaml").Document;
		const result = newEntrySplice(yamlText, doc, "artifact", "b", "label", "b", "\n");
		expect(result).toEqual({ ok: false, reason: "unsupported" });
	});
});
```

実際のテストファイルはすでに `parseDocument` を import 済みかもしれないので、重複 import にならないよう既存の import 文を確認してから追記すること（`frontmatter-cst.test.ts` は現時点で `import { parseFrontmatterCst, setFrontmatterField } from "./frontmatter-cst.js";` および Task 1 で追加した `applySplices` の import を持つ — `newEntrySplice` をこれらと同じ import 文にまとめてよい）。`parseDocument` 自体は `yaml` パッケージから直接 import する必要がある（`import { parseDocument } from "yaml";`）。

- [ ] **Step 2: 失敗を確認**

Run: `cd packages/core && npx vitest run src/frontmatter-cst.test.ts -t newEntrySplice`
Expected: FAIL — `newEntrySplice` is not exported.

- [ ] **Step 3: 実装**

`packages/core/src/frontmatter-cst.ts` に追加（ファイル末尾、`fieldValueSplice` の後）。`lineIndent` と `renderValue` は Task 3 で追加済みのものをそのまま使う。新規に `renderKey` と `childIndentStep` を追加する:

```ts
/** Renders `key` the way `yaml` would quote it as a plain map key. */
function renderKey(key: string): string {
	const tmp = parseDocument("0: 0");
	tmp.set(key, 0);
	const line = tmp
		.toString({ lineWidth: 0 })
		.split("\n")
		.find((l) => l.endsWith(": 0") && !l.startsWith("0:"));
	return (line as string).slice(0, -": 0".length);
}

/**
 * Learn the file's actual per-level indent step from an existing sibling
 * entry's own nested field, instead of assuming the canonical 2 spaces —
 * indentation normalization is `fmt`'s job, not this function's.
 */
function childIndentStep(items: readonly { key: unknown; value: unknown }[], yamlText: string): number {
	for (const item of items) {
		const value = item.value;
		if (isMap(value) && value.items.length > 0) {
			const parentIndent = lineIndent(yamlText, (item.key as Node).range![0]);
			const childKey = value.items[0].key as Node;
			const childIndent = lineIndent(yamlText, childKey.range![0]);
			if (childIndent.length > parentIndent.length) {
				return childIndent.length - parentIndent.length;
			}
		}
	}
	return 2;
}

/**
 * Compute the byte-range splice that creates a brand-new `[kind, id]`
 * frontmatter entry with exactly one field (`field: value`), without
 * touching any other byte of `yamlText`. Shared by `insertDefinition`
 * (always `field: "label"`) and `reindex` (always `field: "index"`) — the
 * two places in this codebase that need to create a node's frontmatter
 * entry from nothing rather than edit an existing one (`fieldValueSplice`
 * handles the latter). Returns `{ ok: false, reason: "unsupported" }` when
 * there is no sibling entry to anchor indentation on (an empty block-style
 * `kind:` section, or an entirely empty document) — callers fall back to
 * full re-serialization for that rare case.
 */
export function newEntrySplice(
	yamlText: string,
	doc: Document,
	kind: "artifact" | "process",
	id: string,
	field: string,
	value: string | number,
	newline: "\n" | "\r\n",
): { ok: true; splice: Splice } | { ok: false; reason: "unsupported" } {
	const idKey = renderKey(id);
	const kindNode = doc.get(kind, true);

	if (isMap(kindNode) && kindNode.items.length > 0) {
		const last = kindNode.items[kindNode.items.length - 1];
		const insertAt = (last.value as Node).range![1];
		if (kindNode.flow) {
			return {
				ok: true,
				splice: {
					start: insertAt,
					end: insertAt,
					replacement: `, ${idKey}: { ${field}: ${renderValue(value, true)} }`,
				},
			};
		}
		const indent = lineIndent(yamlText, (last.key as Node).range![0]);
		const step = childIndentStep(kindNode.items, yamlText);
		const childIndent = indent + " ".repeat(step);
		const content = `${indent}${idKey}:\n${childIndent}${field}: ${renderValue(value, false)}`.replace(
			/\n/g,
			newline,
		);
		const line = padLine(yamlText, insertAt, content, newline);
		return { ok: true, splice: { start: insertAt, end: insertAt, replacement: line } };
	}

	if (isMap(kindNode) && kindNode.items.length === 0) {
		if (kindNode.flow) {
			const openBrace = (kindNode as unknown as Node).range![0];
			return {
				ok: true,
				splice: {
					start: openBrace + 1,
					end: openBrace + 1,
					replacement: ` ${idKey}: { ${field}: ${renderValue(value, true)} }`,
				},
			};
		}
		return { ok: false, reason: "unsupported" };
	}

	// `kind` section doesn't exist yet — insert it as a new top-level key.
	const rootMap = doc.contents;
	if (!isMap(rootMap) || rootMap.items.length === 0) {
		return { ok: false, reason: "unsupported" };
	}
	const last = rootMap.items[rootMap.items.length - 1];
	const insertAt = (last.value as Node).range![1];
	const kindKey = renderKey(kind);
	const content = `${kindKey}:\n  ${idKey}:\n    ${field}: ${renderValue(value, false)}`.replace(
		/\n/g,
		newline,
	);
	const line = padLine(yamlText, insertAt, content, newline);
	return { ok: true, splice: { start: insertAt, end: insertAt, replacement: line } };
}
```

`Node` 型を使うため、ファイル冒頭の `yaml` からの import に `type Node` を追加する: `import { Document, type Node, isAlias, isMap, isScalar, parseDocument } from "yaml";`（Task 3 で追加済みの `isAlias, isMap, isScalar` はそのまま）。`.range![0]` のような非null表明は、Task 3 のレビューで確立した「範囲は必ず存在する」という前提を踏襲している（既存コードの `as [number, number, number]` キャストと同じ意図 — どちらのスタイルでもよいが、ファイル内で混在させない）。

- [ ] **Step 4: 通過を確認**

Run: `cd packages/core && npx vitest run src/frontmatter-cst.test.ts`
Expected: PASS — 全件（既存 + `newEntrySplice` の新規5件）。

- [ ] **Step 5: 型チェック**

Run: `cd packages/core && npx tsgo --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/core/src/frontmatter-cst.ts packages/core/src/frontmatter-cst.test.ts
git commit -m "feat(core): add newEntrySplice primitive for creating new frontmatter entries"
```

#### Part B: `insert-definition.ts` を `newEntrySplice` の薄いラッパーへ書き換え

- [ ] **Step 1: 既存2件の期待値を更新し、失敗させる**

`packages/core/src/insert-definition.test.ts` の以下2箇所を書き換える。

`"locates the section even with a trailing comment on its header"` テスト内:

```ts
// before
expect(output).toContain("artifact:\n  # user artifacts\n");
```
```ts
// after — splice 方式では一行コメントの元位置がそのまま残る(#issue)
expect(output).toContain("artifact: # user artifacts\n  a:\n    label: A\n");
```

`"normalizes an unusual indent width to the canonical 2-space step"` テストのブロックコメントとタイトルを更新:

```ts
// before
it("normalizes an unusual indent width to the canonical 2-space step", () => {
	// The yaml CST (ADR-0034) re-serializes the whole frontmatter block, so
	// an oddly-indented section is canonicalized rather than mirrored.
	const src = `---
artifact:
    a:
        label: A
---
a >> p -> b
`;
	const { output } = insertDefinition(src, "artifact", "b");
	expect(output).toContain("  b:\n    label: b");
});
```
```ts
// after — indentation normalization is fmt's job, not insertDefinition's;
// splicing mirrors whatever step the file already uses (#issue)
it("mirrors an unusual indent width instead of normalizing it", () => {
	const src = `---
artifact:
    a:
        label: A
---
a >> p -> b
`;
	const { output } = insertDefinition(src, "artifact", "b");
	expect(output).toContain("    b:\n        label: b");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd packages/core && npx vitest run src/insert-definition.test.ts`
Expected: この2件が新しい期待値で FAIL（現行実装がまだ splice化されていないため）。他は PASS のまま。

- [ ] **Step 3: 実装**

`packages/core/src/insert-definition.ts` を全面置換（Part A の `newEntrySplice` を薄く呼ぶだけになる）:

```ts
import { Document } from "yaml";
import { applySplices, newEntrySplice, parseFrontmatterCst, renderFrontmatterCst } from "./frontmatter-cst.js";

export interface InsertDefinitionResult {
	output: string;
	inserted: boolean;
}

/**
 * Insert a `label: <id>` definition block for a node that appears only in
 * edges. Splices the new entry's text directly into the source via
 * `newEntrySplice` (ADR-0034 / frontmatter-cst-splice-design): unrelated
 * comments, quote style, flow-vs-block choice, and indentation all survive
 * byte-for-byte — a no-op (and idempotent) when `id` is already defined
 * under `kind`.
 *
 * Returns only the frontmatter block's text, not the whole document —
 * callers (e.g. the VS Code extension's code action) apply it by replacing
 * the document's existing frontmatter range, or inserting it fresh at the
 * top of the file when there was none.
 */
export function insertDefinition(
	source: string,
	kind: "artifact" | "process",
	id: string,
): InsertDefinitionResult {
	const cst = parseFrontmatterCst(source);
	if (cst.present && cst.doc.errors.length > 0) {
		return { output: "", inserted: false };
	}
	if (!cst.present) {
		const doc = new Document();
		doc.setIn([kind, id, "label"], id);
		return { output: renderFrontmatterCst(doc, cst.newline), inserted: true };
	}

	const { doc, yamlText, newline } = cst;
	if (doc.hasIn([kind, id])) {
		return { output: renderFrontmatterCst(doc, newline), inserted: false };
	}

	const result = newEntrySplice(yamlText, doc, kind, id, "label", id, newline);
	if (!result.ok) {
		// Empty block-style kind section, or an entirely empty document body
		// with no other top-level key to anchor on — no sibling text to
		// preserve either way, so a full re-serialize is safe here.
		doc.setIn([kind, id, "label"], id);
		return { output: renderFrontmatterCst(doc, newline), inserted: true };
	}

	const newYamlText = applySplices(yamlText, [result.splice]);
	return { output: `---${newline}${newYamlText}${newline}---${newline}`, inserted: true };
}
```

- [ ] **Step 4: 通過を確認**

Run: `cd packages/core && npx vitest run src/insert-definition.test.ts`
Expected: PASS — 全件（更新した2件含む）。

- [ ] **Step 5: 型チェック**

Run: `cd packages/core && npx tsgo --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/core/src/insert-definition.ts packages/core/src/insert-definition.test.ts
git commit -m "fix(insert-definition): splice new entries instead of full re-serialize

Full re-serialization silently normalized unrelated formatting as a
side effect of inserting an unrelated new id — an unusual indent step
got canonicalized to 2 spaces, and a header's trailing comment moved
to its own line. Neither is insertDefinition's job to do; indentation
normalization belongs to fmt, and comment placement is the author's
choice. Splicing only the new entry's bytes (via the shared
newEntrySplice primitive) leaves both alone."
```

---

### Task 6: `sort.ts` を splice 方式へ書き換え

並び替えは「移動していないノードまで含めて全ノードを再直列化する」という、4箇所の中で最も巻き込み範囲が広いケース。各 Pair の元テキストをバイト範囲ごと切り出して新しい順序で再連結する。

**重要な罠**: yaml パッケージは、セクションヘッダ直後のコメント/空行を「先頭Pairのキー」ではなく「マップ自体」(`map.commentBefore` / `map.spaceBefore`) に付与する。そのため `map.range[0]` を先頭Pairの開始位置に使うと、ヘッダ直後のコメントを取りこぼす。正しい開始位置は「セクションヘッダ行の終端（次の改行の直後）」。

**Files:**
- Modify: `packages/core/src/sort.ts`
- Test: `packages/core/src/sort.test.ts`

**Interfaces:**
- Consumes: `applySplices`（Task 1）、`parseFrontmatterCst` の `yamlText`（Task 2）
- Produces: 既存の `sort()` シグネチャは変更しない。`hoistLeadingTrivia` は不要になり削除する（byte splice はヘッダ直後のコメントをそのまま先頭Pairの範囲に含めて温存するため、yaml のノード属性を手動で付け替える必要がなくなる）。

- [ ] **Step 1: 失敗するテストを書く**

`packages/core/src/sort.test.ts` の `describe("sort: text preservation", ...)` 内に追加:

```ts
it("preserves an untouched folded-scalar's line wraps when the section reorders", () => {
	const src = `---
artifact:
  z:
    label: Z
  foo:
    description: >
      long text
      wrapped here
    label: Foo
---
z >> p -> foo
`;
	const { output } = sort(src, { by: ["id"] });
	expect(output).toContain("description: >\n      long text\n      wrapped here\n");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd packages/core && npx vitest run src/sort.test.ts -t "folded-scalar's line wraps"`
Expected: FAIL — 現行実装は `renderFrontmatterCst` 全文再直列化を通すため1行化される。

- [ ] **Step 3: 実装**

`packages/core/src/sort.ts` を全面置換:

```ts
import { isMap, isScalar, type Pair, type YAMLMap } from "yaml";
import { compareIds } from "./compare.js";
import { applySplices, parseFrontmatterCst, type Splice } from "./frontmatter-cst.js";
import { analyze } from "./index.js";
import { computeTopoOrder } from "./sorter.js";
import type { Diagnostic, NodeKind } from "./types/index.js";

export type SortKey = "index" | "topological" | "group" | "id";

export interface SortOptions {
	by: SortKey[];
}

export interface SortResult {
	output: string;
	changed: boolean;
	diagnostics: Diagnostic[];
}

function pairId(pair: Pair): string {
	return isScalar(pair.key) ? String(pair.key.value) : "";
}

/**
 * The byte offset where `section`'s body begins — the start of the line
 * right after the section header (`artifact:` or `artifact: # comment`).
 * yaml attaches any comment/blank-line immediately after the header to the
 * map itself rather than to the first entry's key, so `map.range[0]` skips
 * past it; anchoring on the header line's own end instead means the first
 * entry's splice range naturally includes that leading trivia without
 * needing to touch yaml's comment-attribution model at all.
 */
function sectionBodyStart(yamlText: string, rootItems: readonly Pair[], section: string): number {
	const topPair = rootItems.find((p) => isScalar(p.key) && p.key.value === section) as Pair;
	const keyRange = (topPair.key as { range: [number, number, number] }).range;
	return yamlText.indexOf("\n", keyRange[1]) + 1;
}

/**
 * Compute the splice that reorders `section`'s entries by `compare`. Each
 * entry's own byte range runs from the previous entry's end (or the
 * section body's start, for the first entry) to its own value's end — so
 * leading comments/blank lines travel with the entry that follows them,
 * and no entry's own text is ever re-serialized. Returns null when the
 * section is absent, empty, or already in the target order.
 */
function sortSplice(
	yamlText: string,
	rootItems: readonly Pair[],
	map: YAMLMap,
	section: string,
	compare: (a: string, b: string) => number,
): Splice | null {
	if (map.items.length === 0) return null;
	const bodyStart = sectionBodyStart(yamlText, rootItems, section);
	const bounds = (map.items as Pair[]).map((item, i) => {
		const prev = map.items[i - 1] as Pair | undefined;
		const start = prev ? (prev.value as { range: [number, number, number] }).range[1] : bodyStart;
		const end = (item.value as { range: [number, number, number] }).range[1];
		return { id: pairId(item), start, end };
	});
	const order = [...bounds].sort((a, b) => compare(a.id, b.id));
	const changed = order.some((b, i) => b !== bounds[i]);
	if (!changed) return null;
	const replacement = order.map((b) => yamlText.slice(b.start, b.end)).join("");
	return { start: bodyStart, end: (map.range as [number, number, number])[1], replacement };
}

/**
 * Reorder nodes within the frontmatter `artifact:`/`process:` sections by one
 * or more sort keys. Splices each section's entries directly into the
 * source (ADR-0034 / frontmatter-cst-splice-design): every entry's own
 * bytes — comments, quote style, flow-vs-block choice, folded-scalar line
 * wraps — survive untouched, whether or not that entry itself moved.
 */
export function sort(source: string, opts: SortOptions): SortResult {
	const { edges, graph, nodeKinds, frontmatter, diagnostics } = analyze(source);
	if (diagnostics.some((d) => d.severity === "error")) {
		return { output: source, changed: false, diagnostics };
	}

	const topoOrder = new Map<string, number>();
	if (opts.by.includes("topological")) {
		const order = computeTopoOrder(edges, graph, frontmatter);
		for (const [rank, id] of order.entries()) topoOrder.set(id, rank);
	}

	const kindOf = (id: string): NodeKind => nodeKinds.get(id) ?? "artifact";

	const getGroup = (id: string): string | null => {
		const kind = kindOf(id);
		const meta = kind === "artifact" ? frontmatter?.artifact?.[id] : frontmatter?.process?.[id];
		return typeof meta?.group === "string" ? meta.group : null;
	};

	const getSortValue = (id: string, key: Exclude<SortKey, "group">): string | number => {
		const kind = kindOf(id);
		const meta = kind === "artifact" ? frontmatter?.artifact?.[id] : frontmatter?.process?.[id];
		switch (key) {
			case "index":
				return typeof meta?.index === "number" ? meta.index : Number.MAX_SAFE_INTEGER;
			case "topological":
				return topoOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
			case "id":
				return id;
		}
	};

	const compare = (a: string, b: string): number => {
		for (const key of opts.by) {
			let cmp: number;
			if (key === "group") {
				const ga = getGroup(a);
				const gb = getGroup(b);
				if (ga === null && gb === null) cmp = 0;
				else if (ga === null) cmp = 1;
				else if (gb === null) cmp = -1;
				else cmp = compareIds(ga, gb);
			} else {
				const va = getSortValue(a, key);
				const vb = getSortValue(b, key);
				cmp = typeof va === "number" && typeof vb === "number" ? va - vb : compareIds(String(va), String(vb));
			}
			if (cmp !== 0) return cmp;
		}
		return 0;
	};

	const cst = parseFrontmatterCst(source);
	if (!cst.present) {
		return { output: source, changed: false, diagnostics };
	}

	const rootItems = (isMap(cst.doc.contents) ? cst.doc.contents.items : []) as Pair[];
	const splices: Splice[] = [];
	for (const section of ["artifact", "process"] as const) {
		const map = cst.doc.get(section, true);
		if (!isMap(map)) continue;
		const splice = sortSplice(cst.yamlText, rootItems, map, section, compare);
		if (splice) splices.push(splice);
	}

	if (splices.length === 0) {
		return { output: source, changed: false, diagnostics };
	}

	const newYamlText = applySplices(cst.yamlText, splices);
	const output = `---${cst.newline}${newYamlText}${cst.newline}---${cst.newline}${cst.body}`;
	return { output, changed: true, diagnostics };
}
```

`compare` は元の `indexed.sort` の「同順位なら元の配列インデックスを保つ」安定ソートに依存していた（`return a.idx - b.idx`）。`Array#sort` は ECMA2019 以降 stable が仕様なので、比較関数が `0` を返した時に元の順序を保つ点は `bounds` 配列（`map.items` の元の並び）そのままの安定ソートで担保される — 明示的な `idx` 比較は不要になる。

- [ ] **Step 4: 通過を確認**

Run: `cd packages/core && npx vitest run src/sort.test.ts`
Expected: PASS — 既存テスト全件（groupテスト、multi-keyテスト、blank-line保持テスト含む）+ 新規1件。blank-line 保持テストは `expect(output).toMatch(/\n[ \t]*\n/)` という緩い正規表現アサーションのため、trivia の扱いが多少変わっても通る想定 — FAILした場合は該当テストの出力を確認し、アサーションの意図（空行が保持されること）を満たしているか個別に判断する。

- [ ] **Step 5: 型チェック**

Run: `cd packages/core && npx tsgo --noEmit`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/core/src/sort.ts packages/core/src/sort.test.ts
git commit -m "fix(sort): splice each section's reordered entries instead of full re-serialize

Reordering rewrote every node's every field via Document#toString(),
even nodes that never moved — collapsing any untouched folded-scalar
(>) description to one line as a side effect. Each entry's own bytes
are now copied verbatim into its new position; nothing that didn't
move is re-serialized at all."
```

---

### Task 7: 全体リグレッション確認

**Files:** なし（検証のみ）

- [ ] **Step 1: core パッケージの全テスト**

Run: `cd packages/core && npx vitest run`
Expected: 全件 PASS。

- [ ] **Step 2: cli パッケージの全テスト（`meta set` の統合テストを含む）**

Run: `cd packages/cli && npx vitest run`
Expected: 全件 PASS。`index.test.ts` に `runMetaSet` 経由の統合テストがあるため、CLI層での回帰がないことを確認する。

- [ ] **Step 3: 型チェックとビルド**

Run: `pnpm -r typecheck && pnpm -r build`
Expected: エラーなし。

- [ ] **Step 4: 実リポジトリでの手動確認**

今回の不具合報告の発端になった再現手順を、実際の CLI 経由でもう一度確認する:

```bash
cd /tmp && mkdir -p pfdsl-splice-check && cd pfdsl-splice-check
cat > sample.pfdsl <<'EOF'
---
artifact:
  spec:
    label: Spec
    description: >
      This is a long description
      that spans multiple lines
      intentionally folded.
    status: todo
---
a >> P -> b
EOF
node /Users/m5/works/pfdsl/packages/cli/dist/cli.js meta set sample.pfdsl spec status wip
cat sample.pfdsl
```

Expected: `description:` の3行の折り返しが保持されたまま、`status: wip` に変わっている。`dist/cli.js` が古い場合は Step 3 のビルド後の成果物を使う。

- [ ] **Step 5: コミット（該当ある場合のみ）**

このタスクはコード変更を伴わない検証のみ。何らかの修正が必要になった場合は、その修正を独立したコミットとして追加する。
