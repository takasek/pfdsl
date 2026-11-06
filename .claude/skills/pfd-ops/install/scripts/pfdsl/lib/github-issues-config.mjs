import { readFileSync } from "node:fs";
import { join } from "node:path";

function readDeclaration(file) {
	let text;
	try {
		text = readFileSync(file, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return false;
		throw error;
	}
	const config = JSON.parse(text);
	const isObject = (value) =>
		value !== null && typeof value === "object" && !Array.isArray(value);
	if (!isObject(config)) throw new Error("expected a JSON object");
	if (!Object.hasOwn(config, "githubIssues")) return false;
	const declaration = config.githubIssues;
	if (!isObject(declaration) || typeof declaration.enabled !== "boolean")
		throw new Error("githubIssues must be an object with a boolean enabled");
	return declaration.enabled;
}

// Deployed CLI entry points resolve the repository from their installation path.
export function requireGitHubIssues(root, operation) {
	const file = join(root, ".pfdsl/config.json");
	try {
		if (readDeclaration(file)) return;
	} catch (error) {
		console.error(`${operation}: ${file}: ${error.message}`);
		process.exit(1);
	}
	console.log(
		`${operation}: not applicable (GitHub Issues is disabled in ${file})`,
	);
	process.exit(0);
}
