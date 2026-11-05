/**
 * `--issue` value parsing, shared by the two cycle scripts that accept the flag.
 *
 * `parseArgs` accepts any string for a `type: "string"` option, so the value
 * only becomes wrong further downstream: `Number("abc")` is NaN, `gh issue view
 * NaN` fails, and the failure surfaces as that issue's checks being unavailable
 * — indistinguishable from a real gh outage, on a table whose other rows are
 * green (#745). Rejecting at parse time keeps the mistake where it was made.
 */

/**
 * @param {string[] | undefined} rawValues the `--issue` occurrences, as given
 * @returns {{ok: true, numbers: number[]} | {ok: false, message: string}}
 */
export function parseIssueNumbers(rawValues) {
	const numbers = [];
	for (const raw of rawValues ?? []) {
		// Number("") is 0 and Number(" 7 ") is 7, so the string is checked as
		// written rather than by round-tripping through Number: a shape this
		// script would silently reinterpret is a shape the caller did not type.
		if (!/^\d+$/.test(raw)) {
			return {
				ok: false,
				message: `--issue expects an issue number, got ${JSON.stringify(raw)}`,
			};
		}
		numbers.push(Number(raw));
	}
	return { ok: true, numbers };
}
