/**
 * The environment variables that redirect Git at a repository other than the
 * one the caller's cwd sits in, and the two questions the repo's scripts ask
 * about them.
 *
 * Kept apart from run-exec.mjs so a caller can sanitize its environment
 * without importing a process runner: scripts/lib/git-ignore-oracle.mjs is
 * reachable from the dist-independent generator, whose module closure must
 * stay clear of the generic `run(file, args)` (scripts/lib/check-script-imports.mjs).
 */

const GIT_TARGET_ENVIRONMENT_VARIABLES = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE",
];

/** Copy an environment without variables that redirect Git's repository state. */
export function withoutGitTargetEnvironment(environment = process.env) {
	const sanitized = { ...environment };
	for (const variable of GIT_TARGET_ENVIRONMENT_VARIABLES) {
		delete sanitized[variable];
	}
	return sanitized;
}

/** Whether an inherited Git target override makes a guarded mutation ambiguous. */
export function hasGitTargetEnvironment(environment = process.env) {
	return GIT_TARGET_ENVIRONMENT_VARIABLES.some(
		(variable) =>
			Object.hasOwn(environment, variable) && environment[variable] !== "",
	);
}
