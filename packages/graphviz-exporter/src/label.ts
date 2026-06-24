const MIN_WRAP_RATIO = 0.3;
const LINE_HEAD_FORBIDDEN = /[、。，．）}\]」』】！？!?]/;
const LINE_END_FORBIDDEN = /[（{[「『【]/;
const BREAK_CHARS = /[、。，．,.\s()（）「」『』【】[\]=]/;

// Times New Roman em widths (per 1000 units), font size = 14pt
const FONT_SIZE = 14;
const CHAR_EM: Record<string, number> = {
	" ": 250,
	"!": 333,
	'"': 408,
	"#": 500,
	$: 500,
	"%": 833,
	"&": 778,
	"'": 180,
	"(": 333,
	")": 333,
	"*": 500,
	"+": 564,
	",": 250,
	"-": 333,
	".": 250,
	"/": 278,
	"0": 500,
	"1": 500,
	"2": 500,
	"3": 500,
	"4": 500,
	"5": 500,
	"6": 500,
	"7": 500,
	"8": 500,
	"9": 500,
	":": 278,
	";": 278,
	"<": 564,
	"=": 564,
	">": 564,
	"?": 444,
	"@": 921,
	A: 722,
	B: 667,
	C: 667,
	D: 722,
	E: 611,
	F: 556,
	G: 722,
	H: 722,
	I: 333,
	J: 389,
	K: 722,
	L: 611,
	M: 889,
	N: 722,
	O: 722,
	P: 556,
	Q: 722,
	R: 667,
	S: 556,
	T: 611,
	U: 722,
	V: 722,
	W: 944,
	X: 722,
	Y: 722,
	Z: 611,
	"[": 333,
	"\\": 278,
	"]": 333,
	"^": 469,
	_: 500,
	"`": 333,
	a: 444,
	b: 500,
	c: 444,
	d: 500,
	e: 444,
	f: 333,
	g: 500,
	h: 500,
	i: 278,
	j: 278,
	k: 500,
	l: 278,
	m: 778,
	n: 500,
	o: 500,
	p: 500,
	q: 500,
	r: 333,
	s: 389,
	t: 278,
	u: 500,
	v: 500,
	w: 722,
	x: 500,
	y: 500,
	z: 444,
	"{": 480,
	"|": 200,
	"}": 480,
	"~": 541,
};

export function measureTextWidth(text: string): number {
	let w = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		if (
			(cp >= 0x3040 && cp <= 0x309f) || // hiragana
			(cp >= 0x30a0 && cp <= 0x30ff) || // katakana
			(cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
			(cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility
			(cp >= 0xff00 && cp <= 0xffef) // fullwidth
		) {
			w += FONT_SIZE; // full-width = 1em
		} else {
			w += ((CHAR_EM[ch] ?? 500) / 1000) * FONT_SIZE;
		}
	}
	return w;
}

export function wrapLabel(text: string, maxWidthPx: number): string {
	if (measureTextWidth(text) <= maxWidthPx) return text;

	const lines: string[] = [];
	let currentLine = "";

	for (let i = 0; i < text.length; i++) {
		const char = text[i]!;
		const testLine = currentLine + char;

		if (measureTextWidth(testLine) > maxWidthPx && currentLine.length > 0) {
			let breakIndex = -1;

			if (!BREAK_CHARS.test(char)) {
				for (let j = currentLine.length - 1; j >= 0; j--) {
					const breakChar = currentLine[j]!;
					if (BREAK_CHARS.test(breakChar)) {
						if (LINE_END_FORBIDDEN.test(breakChar)) continue;
						const widthToBreak = measureTextWidth(
							currentLine.substring(0, j + 1),
						);
						if (widthToBreak > maxWidthPx * MIN_WRAP_RATIO) {
							breakIndex = j;
							break;
						}
					}
				}
			}

			if (breakIndex >= 0) {
				const breakChar = currentLine[breakIndex]!;
				if (LINE_HEAD_FORBIDDEN.test(breakChar)) {
					lines.push(currentLine.substring(0, breakIndex + 1));
					currentLine = currentLine.substring(breakIndex + 1) + char;
				} else {
					lines.push(currentLine.substring(0, breakIndex));
					currentLine = currentLine.substring(breakIndex + 1) + char;
				}
			} else {
				lines.push(currentLine);
				currentLine = char;
			}
		} else {
			currentLine = testLine;
		}
	}

	if (currentLine) lines.push(currentLine);
	return lines.join("\n");
}
