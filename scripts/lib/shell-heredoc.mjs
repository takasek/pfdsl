// Heredoc bodies are input data. Only unquoted-body expansions (or input to
// a shell interpreter) become executable text for the command guards.
export function prepareHeredocs(source, { isShellInput }) {
	let result = "";
	let quote = null;
	let comment = false;
	let lineStart = 0;
	let arithmetic = 0;
	const pending = [];
	for (let i = 0; i < source.length; i++) {
		const ch = source[i];
		if (ch === "\n" && !quote) {
			result += ch;
			comment = false;
			const header = source.slice(lineStart, i);
			for (const doc of pending.splice(0)) {
				const { body, end } = readBody(source, i + 1, doc);
				i = end - 1;
				// Shell stdin is code even when the delimiter was quoted. The
				// synthetic scope makes Git target resolution conservative:
				// consumers may keep later targets unresolved, not restore cwd.
				if (isShellInput(header)) {
					result += `(\n${body}\n)\n`;
				} else if (!doc.quoted) {
					for (const expansion of heredocExpansions(body))
						result += `(\n${expansion}\n)\n`;
				}
			}
			lineStart = i + 1;
			continue;
		}
		if (comment) {
			result += ch;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			result += source.slice(i, i + 2);
			i++;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = null;
			result += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			result += ch;
			continue;
		}
		if (ch === "#" && (i === 0 || /[\s;|&()]/.test(source[i - 1])))
			comment = true;
		if (!comment && source.slice(i, i + 2) === "((") arithmetic += 2;
		else if (arithmetic && ch === "(" && source[i - 1] !== "(") arithmetic++;
		if (arithmetic && ch === ")") arithmetic--;
		if (
			!comment &&
			!arithmetic &&
			source.slice(i, i + 2) === "<<" &&
			source[i + 2] !== "<" &&
			source[i - 1] !== "<"
		) {
			const doc = readDelimiter(source, i + 2);
			if (doc) {
				pending.push(doc);
				result += source.slice(i, doc.end);
				i = doc.end - 1;
				continue;
			}
		}
		result += ch;
	}
	return result;
}

function readLine(source, start, tabs) {
	const newline = source.indexOf("\n", start);
	const end = newline === -1 ? source.length : newline;
	const line = source.slice(start, end);
	return {
		line: tabs ? line.replace(/^\t+/, "") : line,
		next: newline === -1 ? end : end + 1,
	};
}

function readBody(source, start, doc) {
	let body = "";
	let end = start;
	while (end < source.length) {
		let { line, next } = readLine(source, end, doc.tabs);
		end = next;
		// Unquoted bodies join backslash-newline before delimiter comparison.
		while (
			!doc.quoted &&
			/(?:^|[^\\])(?:\\\\)*\\$/.test(line) &&
			end < source.length
		) {
			const continuation = readLine(source, end, doc.tabs);
			line = line.slice(0, -1) + continuation.line;
			end = continuation.next;
		}
		if (line === doc.delimiter) break;
		body += `${line}\n`;
	}
	return { body, end };
}

function readDelimiter(source, start) {
	let i = start;
	const tabs = source[i] === "-";
	if (tabs) i++;
	while (/[ \t]/.test(source[i] ?? "")) i++;
	let delimiter = "";
	let quote = null;
	let quoted = false;
	const wordStart = i;
	for (; i < source.length; i++) {
		const ch = source[i];
		if (!quote && /[\s;|&()<>]/.test(ch)) break;
		if (!quote && ch === "$" && source[i + 1] === '"') return null;
		if (!quote && source.slice(i, i + 2) === "$'") {
			const ansi = readAnsiQuoted(source, i + 2);
			if (ansi === null) return null;
			delimiter += ansi.value;
			quoted = true;
			i = ansi.end;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			const next = source[++i];
			if (next === undefined) return null;
			if (next !== "\n") quoted = true;
			if (quote === '"' && !/[$`"\\\n]/.test(next)) delimiter += "\\";
			if (next !== "\n") delimiter += next;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = null;
			else delimiter += ch;
		} else if (ch === "'" || ch === '"') {
			quote = ch;
			quoted = true;
		} else delimiter += ch;
	}
	return i > wordStart && !quote ? { delimiter, quoted, tabs, end: i } : null;
}

// Unknown ANSI-C escapes stay unmasked rather than guessing a delimiter and
// accidentally consuming real commands after it.
function readAnsiQuoted(source, start) {
	let value = "";
	for (let i = start; i < source.length; i++) {
		if (source[i] === "'") return { value, end: i };
		if (source[i] !== "\\") {
			value += source[i];
			continue;
		}
		const ch = source[++i];
		const simple = {
			a: "\x07",
			b: "\b",
			e: "\x1b",
			E: "\x1b",
			f: "\f",
			n: "\n",
			r: "\r",
			t: "\t",
			v: "\v",
			"\\": "\\",
			"'": "'",
			'"': '"',
		};
		if (Object.hasOwn(simple, ch)) {
			value += simple[ch];
			continue;
		}
		const escaped = source
			.slice(i)
			.match(
				/^(?:x([\da-fA-F]{1,2})|u([\da-fA-F]{4})|U([\da-fA-F]{8})|([0-7]{1,3}))/,
			);
		if (!escaped) return null;
		const code = Number.parseInt(
			escaped[1] ?? escaped[2] ?? escaped[3] ?? escaped[4],
			escaped[4] ? 8 : 16,
		);
		// Byte escapes and Unicode output depend on byte truncation/locale.
		// Mask only ASCII escapes, whose delimiter is unambiguous here.
		if (code === 0 || code > 0x7f) return null;
		value += String.fromCodePoint(code);
		i += escaped[0].length - 1;
	}
	return null;
}

function heredocExpansions(body, shellSyntax = false) {
	const expansions = [];
	let shellQuote = null;
	for (let i = 0; i < body.length; i++) {
		if (shellSyntax && (body[i] === "'" || body[i] === '"')) {
			if (shellQuote === body[i]) shellQuote = null;
			else if (!shellQuote) shellQuote = body[i];
			continue;
		}
		if (shellQuote === "'") continue;
		if (body[i] === "\\" && /[$`\\\n]/.test(body[i + 1] ?? "")) {
			i++;
			continue;
		}
		if (body[i] === "`") {
			let text = "";
			for (i++; i < body.length && body[i] !== "`"; i++) {
				if (body[i] === "\\" && /[$`\\]/.test(body[i + 1] ?? "")) i++;
				text += body[i];
			}
			expansions.push(text);
			expansions.push(...heredocExpansions(text, true));
		} else if (body.slice(i, i + 2) === "$(") {
			let depth = 1;
			let quote = null;
			const start = i + 2;
			for (i = start; i < body.length; i++) {
				const ch = body[i];
				if (ch === "\\" && quote !== "'") {
					i++;
					continue;
				}
				if (quote) {
					if (ch === quote) quote = null;
					continue;
				}
				if (ch === "'" || ch === '"') {
					quote = ch;
					continue;
				}
				if (ch === "(") depth++;
				if (ch === ")" && --depth === 0) break;
			}
			const text = body.slice(start, i);
			expansions.push(text, ...heredocExpansions(text, true));
		}
	}
	return expansions;
}
