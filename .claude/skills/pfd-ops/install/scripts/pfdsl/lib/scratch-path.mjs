/**
 * Computes the scratch-file path sweep-completed-chains.mjs verifies a
 * delete candidate at (issue #1125 defect: verifying in a different
 * directory than the swept file). `pfdsl check` resolves a relative
 * `extends:`/`subflow:` from the file being checked own directory, so a
 * candidate verified anywhere else can fail a check that the real file (in
 * its real location) passes — or, worse, silently pass a check the real
 * location would fail. Putting the candidate next to the original makes its
 * relative references resolve exactly the way they would after `--write`
 * lands.
 *
 * No I/O here: picking a name that does not collide with an existing file,
 * and removing it afterwards, are the caller's job.
 */

import { basename, dirname, extname, join } from "node:path";

/**
 * @param {string} file path to the file being swept
 * @param {string} token a value that makes the returned name unique for one
 *   verification run (e.g. a random hex string)
 * @returns {string} a path in the same directory as `file`
 */
export function scratchPathFor(file, token) {
	const dir = dirname(file);
	const ext = extname(file) || ".pfdsl";
	const stem = basename(file, extname(file));
	return join(dir, `${stem}.sweep-verify-${token}${ext}`);
}
