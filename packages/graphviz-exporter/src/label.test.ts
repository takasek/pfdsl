import { describe, expect, it } from "vitest";
import { measureTextWidth, wrapLabel } from "./label.js";

/** Everything the label carries apart from where the lines were broken. */
function withoutBreaks(text: string): string {
	return text.replace(/\s+/g, "");
}

describe("measureTextWidth", () => {
	it("is zero for the empty string", () => {
		expect(measureTextWidth("")).toBe(0);
	});

	it("charges a full em per CJK character at the 14pt font size", () => {
		expect(measureTextWidth("設計")).toBe(28);
	});

	it("treats hiragana, katakana and fullwidth forms as full-width too", () => {
		expect(measureTextWidth("あ")).toBe(14);
		expect(measureTextWidth("ア")).toBe(14);
		expect(measureTextWidth("Ａ")).toBe(14);
	});

	it("uses per-character Times metrics for ASCII, so 'i' is narrower than 'W'", () => {
		expect(measureTextWidth("i")).toBeLessThan(measureTextWidth("W"));
	});

	it("falls back to a 500/1000 em for characters outside the table", () => {
		// Not CJK and not in CHAR_EM — e.g. a Cyrillic letter.
		expect(measureTextWidth("д")).toBe(7);
	});

	it("is additive across characters", () => {
		expect(measureTextWidth("ab")).toBeCloseTo(
			measureTextWidth("a") + measureTextWidth("b"),
			10,
		);
	});
});

describe("wrapLabel", () => {
	it("returns the text untouched when it already fits", () => {
		expect(wrapLabel("short", 1000)).toBe("short");
	});

	it("breaks at a space and consumes it, since the newline replaces it", () => {
		expect(wrapLabel("alpha beta", 40)).toBe("alpha\nbeta");
	});

	it("splits a token with no break opportunity rather than overflowing", () => {
		const wrapped = wrapLabel("averylongtokenwithnobreaks", 40);
		expect(wrapped).toContain("\n");
		expect(withoutBreaks(wrapped)).toBe("averylongtokenwithnobreaks");
	});

	// The bug this suite was written for: a break character that is not
	// whitespace used to be swallowed, so "v0.0.8" rendered as "v0.0" / "8" and
	// "(#97)" as "" / "#97)". 25 labels in the repository's own .pfdsl files
	// were losing characters this way.
	describe("no character is lost to a break", () => {
		it.each([
			["仕様書 v0.0.8（マルチファイル統合）", 130],
			["externalStakeholders フィールド仕様案 (#97)", 130],
			["CLI --no-color / NO_COLOR 対応 (#180)", 130],
			["index フィールド + reindex コマンド (#221)", 130],
			["a=b c=d e=f g=h", 40],
			["one, two, three, four", 50],
		])("keeps every non-space character of %s", (text, maxWidth) => {
			expect(withoutBreaks(wrapLabel(text, maxWidth))).toBe(
				withoutBreaks(text),
			);
		});

		it("keeps a dot that falls at the break, so a version stays readable", () => {
			// The '.' belongs to the text; it ends the line rather than vanishing.
			const wrapped = wrapLabel("仕様書 v0.0.8（マルチファイル統合）", 130);
			expect(wrapped).not.toMatch(/v0\.0\n/);
			expect(withoutBreaks(wrapped)).toContain("v0.0.8");
		});

		it("keeps an opening parenthesis with its line instead of dropping it", () => {
			const wrapped = wrapLabel(
				"externalStakeholders フィールド仕様案 (#97)",
				130,
			);
			expect(withoutBreaks(wrapped)).toContain("(#97)");
		});
	});

	describe("Japanese line-breaking rules", () => {
		it("does not start a line with a closing punctuation mark", () => {
			const wrapped = wrapLabel(
				"設計する、実装する。テストする、リリースする",
				60,
			);
			for (const line of wrapped.split("\n")) {
				expect(line[0]).not.toMatch(/[、。）」』】！？]/);
			}
		});

		it("does not break right after an opening bracket", () => {
			const wrapped = wrapLabel(
				"レビュー（差分の確認と承認）を実施してからリリースする",
				60,
			);
			for (const line of wrapped.split("\n")) {
				expect(line.at(-1)).not.toMatch(/[（「『【{[]/);
			}
		});

		it("prefers a later break over one that would leave a very short line", () => {
			// A break under 30% of the width is rejected, so the space after the
			// one-character word is not used.
			const wrapped = wrapLabel("a bbbbbbbbbbbbbbbb cccc", 80);
			expect(wrapped.split("\n")[0]).not.toBe("a");
		});
	});
});
