/**
 * Ordering for ids, labels and group names.
 *
 * `localeCompare` without a locale reads the environment's, so the same file
 * sorted on two machines could come out in different orders — `"i"` and `"I"`
 * swap under a Turkish collation, and the sorted output is committed (formatted
 * `.pfdsl`, generated `.dot`, README). Pinning the locale keeps the existing
 * ordering while taking the environment out of it (#640).
 */

const ORDERING_LOCALE = "en-US";

/** Compare two ids/labels for sort order, independent of the host locale. */
export function compareIds(a: string, b: string): number {
	return a.localeCompare(b, ORDERING_LOCALE);
}
