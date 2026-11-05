/**
 * Validation shared by the npm publish workflows. The checked out ref must be
 * a release tag, and every package in a release kind must carry that tag's
 * version.
 */

/**
 * @param {string} ref
 * @param {string} prefix
 * @returns {{tag: string, version: string}}
 */
export function parseReleaseRef(ref, prefix) {
	const marker = "refs/tags/";
	if (typeof ref !== "string" || !ref.startsWith(marker)) {
		throw new Error("release workflow requires a tag ref");
	}
	const tag = ref.slice(marker.length);
	if (!tag.startsWith(prefix) || tag.length === prefix.length) {
		throw new Error(`release tag must use the ${prefix} prefix`);
	}
	return { tag, version: tag.slice(prefix.length) };
}

/**
 * Validate the event ref, manual input and package versions before publish.
 * @param {{event: string, ref: string, tag: string, packageVersions: string[], prefix?: string}} input
 * @returns {string | null}
 */
export function validateReleaseRef({
	event,
	ref,
	tag,
	packageVersions,
	prefix = tag?.startsWith("lib-v") ? "lib-v" : "v",
}) {
	let parsed;
	try {
		parsed = parseReleaseRef(ref, prefix);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	if (tag !== parsed.tag) return "release tag must match the checked out ref";
	if (event !== "push" && event !== "workflow_dispatch") {
		return `unsupported release event: ${event}`;
	}
	if (
		new Set(packageVersions).size !== 1 ||
		packageVersions[0] !== parsed.version
	) {
		return "package versions do not match the release tag";
	}
	return null;
}
