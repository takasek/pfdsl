/**
 * Pure functions and config for the release targets. git/gh/pnpm I/O lives in
 * scripts/release-runner.mjs; this module stays testable.
 */

import { parseArgs } from "node:util";

/**
 * @typedef {Object} ReleaseKind
 * @property {string[]} packages - package.json paths to bump, repo-root-relative
 * @property {string} tagPrefix
 * @property {string | null} workflow - GHA workflow file name to watch, or null (vscode has none)
 */

/** @type {Record<string, ReleaseKind>} */
export const RELEASE_KINDS = {
	cli: {
		packages: ["packages/cli/package.json"],
		tagPrefix: "v",
		workflow: "publish-cli.yml",
	},
	libs: {
		packages: [
			"packages/core/package.json",
			"packages/graphviz-exporter/package.json",
			"packages/preview-engine/package.json",
		],
		tagPrefix: "lib-v",
		workflow: "publish-libraries.yml",
	},
	vscode: {
		packages: ["packages/vscode-extension/package.json"],
		tagPrefix: "vscode-v",
		workflow: null,
	},
};

/**
 * Parse the two-phase release entrypoint before any repository command runs.
 * @param {string[]} args
 * @returns {{kindArg: string, phase: "prepare" | "publish", version?: string, commit?: string}}
 */
export function parseReleaseArgs(args) {
	let parsed;
	try {
		parsed = parseArgs({
			args,
			options: {
				version: { type: "string" },
				commit: { type: "string" },
			},
			strict: true,
			allowPositionals: true,
		});
	} catch (error) {
		throw new Error(error instanceof Error ? error.message : String(error));
	}

	if (parsed.positionals.length !== 2) {
		throw new Error("expected release kind and phase");
	}
	const [kindArg, phase] = parsed.positionals;
	if (!RELEASE_KINDS[kindArg]) {
		throw new Error(
			`unknown release kind '${kindArg}' (expected one of: ${Object.keys(RELEASE_KINDS).join(", ")})`,
		);
	}
	if (phase !== "prepare" && phase !== "publish") {
		throw new Error(
			`unknown release phase '${phase}' (expected prepare or publish)`,
		);
	}

	const { version, commit } = parsed.values;
	if (phase === "prepare") {
		if (commit !== undefined)
			throw new Error("--commit is not allowed for prepare");
		if (version === undefined || version === "")
			throw new Error("--version is required for prepare");
	} else {
		if (version !== undefined)
			throw new Error("--version is not allowed for publish");
		if (commit === undefined || !/^[0-9a-f]{40}$/i.test(commit))
			throw new Error("a full 40-character commit SHA is required for publish");
	}

	return { kindArg, phase, version, commit };
}

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

/**
 * Picks out candidate artifact IDs from ready release processes. The result is
 * display-only: the release runner never mutates roadmap state.
 * @param {{id: string, outputs: string[]}[]} readyItems - the `ready` array from `pfdsl status ready --json`
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function releaseMilestoneCandidateArtifactIds(
	readyItems,
	prefix = "publish_cli_",
) {
	return readyItems
		.filter((item) => item.id.startsWith(prefix))
		.flatMap((item) => item.outputs);
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
