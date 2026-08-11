/**
 * retro-patterns.mjs's printing, as pure functions that return text instead
 * of calling console.log — so the shape of what a reader sees (section
 * headings, line order, count phrasing) is something a test can assert on,
 * not something only a human staring at a terminal can (#820).
 *
 * `console.log(x)` writes `x + "\n"`; a run of them is byte-identical to
 * `[...xs].join("\n") + "\n"`. Every render* function below returns the
 * `join("\n")` half — the caller (renderCommand, or the CLI for `check`)
 * adds the final newline once when it prints.
 */

import { parseArgs } from "node:util";
import {
	checkPatternFile,
	collectTags,
	groupTagsByAxis,
	keyLinesOf,
	near,
	select,
	summaryOf,
} from "./retro-patterns.mjs";

/**
 * One pattern, formatted as head line, optional note, path, summary, and any
 * `問いの形` / `具体例` key lines.
 * @param {{name: string, tags: string[], body: string, path: string}} pattern
 * @param {string} [note] - printed under the head line, where a reader looks
 *   for why this entry is in front of them at all.
 * @returns {string}
 */
export function renderPattern({ name, tags, body, path }, note) {
	const lines = [`${name}  [${tags.join(", ")}]`];
	if (note !== undefined) lines.push(`  ${note}`);
	lines.push(`  ${path}`);
	lines.push(`  ${summaryOf(body)}`);
	for (const line of keyLinesOf(body)) lines.push(`  ${line}`);
	return lines.join("\n");
}

/** @param {{name: string, tags: string[], body: string, path: string}[]} patterns */
export function renderTags(patterns) {
	const lines = [];
	for (const { axis, tags } of groupTagsByAxis(collectTags(patterns))) {
		lines.push(`[${axis || "no axis"}]`);
		for (const { tag, patterns: tagged } of tags) {
			lines.push(`  ${tag}  ${tagged.length}`);
			for (const p of tagged) lines.push(`    ${p.name}  ${p.path}`);
		}
	}
	lines.push(
		`\n${patterns.length} pattern(s). Pick the tags whose condition held this cycle; --tag unions them.`,
	);
	return lines.join("\n");
}

/**
 * @param {{name: string, tags: string[], body: string, path: string}[]} patterns
 * @param {{tags: string[], words: string[]}} query
 */
export function renderSelection(patterns, query) {
	const { tagged, wordOnly, always, reach, pool, unselective } = select(
		patterns,
		query,
	);
	const lines = [];

	lines.push(`## tagged (${tagged.length} of ${pool})`);
	if (unselective) {
		lines.push(
			`  ${tagged.length} of ${pool} is not a narrowing — the tags held too widely this cycle.`,
		);
		lines.push(
			"  Read down the ranking, not across the list, and do not treat the end of it as the end of the audit.",
		);
	}
	for (const { pattern, matched } of tagged)
		lines.push(
			renderPattern(
				pattern,
				`matched ${matched.length}/${query.tags.length}: ${matched.join(", ")}`,
			),
		);

	lines.push(
		`\n## word-only (${wordOnly.length} of ${pool - tagged.length}) — what the tags missed`,
	);
	if (reach.length > 0) {
		lines.push(
			`  reach before subtraction: ${reach.map((r) => `${r.word} ${r.count}`).join(", ")}`,
		);
		lines.push(
			"  reach counts patterns; `near --word <word>` names which, the tagged ones included.",
		);
	}
	if (query.words.length === 0) {
		lines.push(
			"  no --word given. Tags only answer what someone anticipated; pass a few",
		);
		lines.push(
			"  concrete terms from this cycle's diff to see what they did not.",
		);
	}
	for (const { pattern, hits } of wordOnly) {
		lines.push(renderPattern(pattern));
		for (const h of hits) lines.push(`    L${h.line} ${h.word}: ${h.text}`);
	}

	lines.push(`\n## always (${always.length})`);
	for (const p of always) lines.push(renderPattern(p));

	const shown = tagged.length + wordOnly.length + always.length;
	lines.push(
		`\nShown ${shown} of ${patterns.length} — shown, not read. Open the paths above.`,
	);
	return lines.join("\n");
}

/**
 * @param {{name: string, tags: string[], body: string, path: string}[]} patterns
 * @param {string[]} words
 */
export function renderNear(patterns, words) {
	const matches = near(patterns, words);
	const lines = [
		`## near (${matches.length}) — ranked by how many lines the words hit, most first. Open the top few before writing a new pattern.`,
	];
	for (const { pattern, hits } of matches) {
		lines.push(renderPattern(pattern));
		for (const h of hits) lines.push(`    L${h.line} ${h.word}: ${h.text}`);
	}
	return lines.join("\n");
}

/**
 * Every pattern file's violations, one line per violation as `path: reason`,
 * or a single summary line when every file is clean. Runs checkPatternFile
 * per file rather than through parsePatternFile, so a single unparsable file
 * is reported as one violation among the rest instead of throwing.
 * @param {{path: string, name: string, text: string}[]} files
 * @returns {{text: string, clean: boolean}}
 */
export function renderCheck(files) {
	let clean = true;
	const lines = [];
	for (const file of files) {
		for (const reason of checkPatternFile(file)) {
			clean = false;
			lines.push(`${file.path}: ${reason}`);
		}
	}
	if (clean) lines.push(`${files.length} pattern file(s), no violations.`);
	return { text: lines.join("\n"), clean };
}

/**
 * Repeated `--tag` / `--word` options. Strict parsing, not a hand-rolled
 * argv walk: a walk that only recognizes the bare `--flag value` form drops
 * the `--flag=value` spelling silently and calls it done rather than an
 * unrecognized flag — the defect scripts/gate-check.mjs's own parseArgs
 * migration was written to close (#648).
 * @param {string[]} argv
 * @returns {{tags: string[], words: string[]}}
 */
export function parseQuery(argv) {
	const { values } = parseArgs({
		args: argv,
		options: {
			tag: { type: "string", multiple: true },
			word: { type: "string", multiple: true },
		},
		strict: true,
		allowPositionals: false,
	});
	return { tags: values.tag ?? [], words: values.word ?? [] };
}

/**
 * The `--word` options of a query whose `--tag` is refused rather than
 * ignored. Ranking a draft against the whole catalog has no cycle whose tags
 * would narrow it, so a tag here means the caller expected `select`.
 * @param {string[]} argv
 * @returns {string[]}
 */
export function parseWords(argv) {
	const { tags, words } = parseQuery(argv);
	if (tags.length > 0) {
		throw new Error("near takes no --tag: it ranks the whole catalog");
	}
	return words;
}

/**
 * The sole binding of a subcommand name to the render function that answers
 * it. Kept as one function precisely so a mistake here — near wired to
 * renderSelection, say — shows up in a test that asserts on which heading
 * came back, rather than only in a human reading the terminal (#820).
 * @param {string | undefined} command
 * @param {string[]} argv
 * @param {{patterns?: {name: string, tags: string[], body: string, path: string}[], files?: {path: string, name: string, text: string}[]}} ctx
 * @returns {{text: string, ok: boolean}}
 */
export function renderCommand(command, argv, { patterns, files }) {
	if (command === "check") {
		const { text, clean } = renderCheck(files);
		return { text, ok: clean };
	}
	if (command === "tags") return { text: renderTags(patterns), ok: true };
	if (command === "list")
		return { text: patterns.map((p) => renderPattern(p)).join("\n"), ok: true };
	if (command === "select")
		return { text: renderSelection(patterns, parseQuery(argv)), ok: true };
	if (command === "near") {
		const words = parseWords(argv);
		if (words.length === 0)
			throw new Error("near requires at least one --word");
		return { text: renderNear(patterns, words), ok: true };
	}
	return {
		text: "usage: retro-patterns.mjs tags | list | select [...] | near --word <word>... | check",
		ok: false,
	};
}
