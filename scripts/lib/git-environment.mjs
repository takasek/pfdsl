/**
 * Environment variables that redirect Git's repository state or inject
 * configuration, which can redirect that state or override core.hooksPath.
 *
 * Kept apart from run-exec.mjs so a caller can sanitize its environment
 * without importing a process runner: scripts/lib/git-ignore-oracle.mjs is
 * reachable from the dist-independent generator, whose module closure must
 * stay clear of the generic `run(file, args)` (scripts/lib/check-script-imports.mjs).
 */

export const GIT_TARGET_ENVIRONMENT_VARIABLES = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_GLOBAL",
	"GIT_CONFIG_SYSTEM",
	"GIT_CONFIG",
];

export function gitEnvironmentValueIsSafe(variable, value) {
	return value === "" || (variable === "GIT_CONFIG_COUNT" && value === "0");
}

/** Copy an environment without variables that redirect Git's repository state. */
export function withoutGitTargetEnvironment(environment = process.env) {
	const sanitized = { ...environment };
	for (const variable of Object.keys(sanitized)) {
		if (
			GIT_TARGET_ENVIRONMENT_VARIABLES.includes(variable) ||
			/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(variable)
		)
			delete sanitized[variable];
	}
	return sanitized;
}

/** Whether an inherited Git target override makes a guarded mutation ambiguous. */
export function hasGitTargetEnvironment(environment = process.env) {
	return GIT_TARGET_ENVIRONMENT_VARIABLES.some(
		(variable) =>
			Object.hasOwn(environment, variable) &&
			!gitEnvironmentValueIsSafe(variable, environment[variable]),
	);
}
