import { readdirSync } from "node:fs";
import { resolve } from "node:path";

export function formatPluginAssemblyError(error) {
	const primary = error instanceof Error ? error.message : String(error);
	const paths =
		typeof error?.rollbackBackup === "string"
			? [error.rollbackBackup]
			: (Array.isArray(error?.rollbackBackups)
					? error.rollbackBackups
					: []
				).filter((path) => typeof path === "string" && path.length > 0);
	if (!paths.length) return primary;
	return `${primary}\nRollback restoration did not complete. Recovery snapshots were preserved at:\n${[...new Set(paths)].map((path) => `  ${path}`).join("\n")}`;
}

// This can also find an active transaction or a failed cleanup, so it does not
// claim every directory proves a rollback failure or authorize deleting it.
export function pluginRecoveryNotice(root) {
	const directory = resolve(root, "plugin");
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return "";
		return `Could not inspect generator transaction data at ${directory}: ${error.message}`;
	}
	const paths = entries
		.filter(
			(entry) =>
				entry.isDirectory() && entry.name.startsWith(".pfdsl-gen-txn-"),
		)
		.map((entry) => resolve(directory, entry.name))
		.sort();
	if (!paths.length) return "";
	return `Generator transaction data remain (possibly preserved rollback snapshots):\n${paths.map((path) => `  ${path}`).join("\n")}\nA failed rollback preserves these directories for recovery. Inspect the data and the original assembly error before removing them; a retry does not recover or delete them.`;
}
