import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	findStaleForwardRefs,
	formatStaleForwardRefs,
} from "./stale-forward-ref-check.mjs";

describe("findStaleForwardRefs", () => {
	it("finds a single occurrence of a known phrase", () => {
		const text = "line one\nクロスファイル revises はマルチファイル仕様（将来版）に委ねる。\nline three";
		const hits = findStaleForwardRefs(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].line, 2);
		assert.equal(hits[0].phrase, "将来版に委ねる");
	});

	it("finds the second known phrase independently", () => {
		const text = "詳細は別途定義する。";
		const hits = findStaleForwardRefs(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].phrase, "別途定義する");
	});

	it("finds multiple occurrences across lines", () => {
		const text = "将来版に委ねる\nfiller\n別途定義する";
		const hits = findStaleForwardRefs(text);
		assert.equal(hits.length, 2);
		assert.deepEqual(
			hits.map((h) => h.line),
			[1, 3],
		);
	});

	it("returns an empty array when no phrase is present", () => {
		assert.deepEqual(findStaleForwardRefs("nothing to see here"), []);
	});

	it("matches the real spec.md phrasing with an adjacent closing paren", () => {
		const text = "その意味論の完全な定義はマルチファイル仕様（将来版）に委ねる。";
		const hits = findStaleForwardRefs(text);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].phrase, "将来版に委ねる");
	});

	it("captures the trimmed line as context", () => {
		const text = "   indented 将来版に委ねる text   ";
		const hits = findStaleForwardRefs(text);
		assert.equal(hits[0].context, "indented 将来版に委ねる text");
	});
});

describe("formatStaleForwardRefs", () => {
	it("formats file:line and phrase with context", () => {
		const hits = [
			{ file: "docs/spec/spec.md", line: 42, phrase: "将来版に委ねる", context: "foo 将来版に委ねる bar" },
		];
		const out = formatStaleForwardRefs(hits);
		assert.match(out, /docs\/spec\/spec\.md:42/);
		assert.match(out, /将来版に委ねる/);
		assert.match(out, /foo 将来版に委ねる bar/);
	});

	it("joins multiple hits with newlines", () => {
		const hits = [
			{ file: "a.md", line: 1, phrase: "将来版に委ねる", context: "x" },
			{ file: "b.md", line: 2, phrase: "別途定義する", context: "y" },
		];
		const out = formatStaleForwardRefs(hits);
		assert.match(out, /a\.md:1/);
		assert.match(out, /b\.md:2/);
	});
});
