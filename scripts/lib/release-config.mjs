/**
 * Pure functions and config for the release targets (release / release-libs /
 * vscode-package). git/gh/pnpm I/O lives in scripts/release.mjs; this module
 * stays testable.
 */

/**
 * @typedef {Object} ReleaseKind
 * @property {string[]} packages - package.json paths to bump, repo-root-relative
 * @property {string} tagPrefix
 * @property {string | null} workflow - GHA workflow file name to watch, or null (vscode has none)
 * @property {(version: string) => string} commitMessage
 */

/** @type {Record<string, ReleaseKind>} */
export const RELEASE_KINDS = {
	cli: {
		packages: ["packages/cli/package.json"],
		tagPrefix: "v",
		workflow: "publish-cli.yml",
		commitMessage: (v) => `chore(package): bump version to ${v}`,
	},
	libs: {
		packages: [
			"packages/core/package.json",
			"packages/graphviz-exporter/package.json",
			"packages/preview-engine/package.json",
		],
		tagPrefix: "lib-v",
		workflow: "publish-libraries.yml",
		commitMessage: (v) => `chore(libs): bump library versions to ${v}`,
	},
	vscode: {
		packages: ["packages/vscode-extension/package.json"],
		tagPrefix: "vscode-v",
		workflow: null,
		commitMessage: (v) => `chore(package): bump vscode-extension version to ${v}`,
	},
};

/**
 * Rewrites only the "version" field of a package.json source string,
 * preserving key order and the trailing newline convention used across
 * this repo's package.json files (tab-indented, trailing \n).
 * @param {string} src
 * @param {string} version
 * @returns {string}
 */
export function bumpVersionInPackageJson(src, version) {
	const pkg = JSON.parse(src);
	pkg.version = version;
	return `${JSON.stringify(pkg, null, "\t")}\n`;
}

/**
 * @param {ReleaseKind} kind
 * @param {string} version
 * @returns {string}
 */
export function tagName(kind, version) {
	return `${kind.tagPrefix}${version}`;
}

const MARKETPLACE_PLUGIN_REPO_URL = "https://github.com/takasek/pfdsl.git";
const MARKETPLACE_PLUGIN_PATH = "plugin/pfdsl";

/**
 * Points the pfdsl plugin's marketplace.json entry at a specific CLI release
 * tag, so `/plugin install` and `/plugin marketplace update` fetch a pinned,
 * previously-verified snapshot instead of main's current (possibly broken)
 * HEAD. First run replaces the bare relative-path shorthand source with the
 * explicit git-subdir form; later runs just rewrite its `ref`.
 * @param {string} src
 * @param {string} tag
 * @returns {string}
 */
export function pinMarketplaceSourceToTag(src, tag) {
	const marketplace = JSON.parse(src);
	marketplace.plugins[0].source = {
		source: "git-subdir",
		url: MARKETPLACE_PLUGIN_REPO_URL,
		path: MARKETPLACE_PLUGIN_PATH,
		ref: tag,
	};
	return `${JSON.stringify(marketplace, null, "\t")}\n`;
}
