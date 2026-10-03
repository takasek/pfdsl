#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const isObject = (value) =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const reasons = {
	"missing-config": "The config file is missing.",
	"invalid-json": "The config file is not valid JSON.",
	"invalid-config": "The config root must be an object.",
	"missing-declaration": "The knowledgeLifecycleAudit key is missing.",
	"invalid-declaration": "knowledgeLifecycleAudit must be an object.",
	"invalid-mode": "mode must be adopt or decline.",
	"invalid-targets":
		"adopt requires a non-empty targets array of strings with non-whitespace content.",
};

/** Classify only the declared config; legacy binding lines never add targets. */
export function classifyDeclaration(configText, bindingText = "") {
	const reports = [];
	if (
		/^(?:knowledge-lifecycle-audit|知識成果物ライフサイクル監査):/m.test(
			bindingText,
		)
	) {
		reports.push({
			code: "retired-declaration",
			message:
				"The declaration moved to .pfdsl/config.json. The owner must check whether the old binding line agrees with the config, even when mode is decline.",
		});
	}
	function result(state, auditTargets = []) {
		if (reasons[state])
			reports.unshift({
				code: state,
				message: `${reasons[state]} The owner must declare knowledgeLifecycleAudit in .pfdsl/config.json.`,
			});
		return { state, auditTargets, reportRequired: reports.length > 0, reports };
	}
	if (configText === undefined) return result("missing-config");
	let config;
	try {
		config = JSON.parse(configText);
	} catch {
		return result("invalid-json");
	}
	if (!isObject(config)) return result("invalid-config");
	if (!Object.hasOwn(config, "knowledgeLifecycleAudit"))
		return result("missing-declaration");
	const declaration = config.knowledgeLifecycleAudit;
	if (!isObject(declaration)) return result("invalid-declaration");
	if (declaration.mode === "decline") return result("decline");
	if (declaration.mode !== "adopt") return result("invalid-mode");
	const targets = declaration.targets;
	if (
		!Array.isArray(targets) ||
		targets.length === 0 ||
		targets.some((target) => typeof target !== "string" || target.trim() === "")
	)
		return result("invalid-targets");
	return result("adopt", targets);
}

function readOptional(path) {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return undefined;
		throw new Error(`Cannot read ${path}: ${error.message}`);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
	try {
		const args = process.argv.slice(2);
		if (args.length > 1 || args[0]?.startsWith("-"))
			throw new Error(
				"Usage: node classify-knowledge-lifecycle.mjs [repository-root]",
			);
		const root = resolve(args[0] ?? process.cwd());
		const config = readOptional(resolve(root, ".pfdsl/config.json"));
		const binding = readOptional(resolve(root, ".pfdsl/bindings/pfd-retro.md"));
		console.log(JSON.stringify(classifyDeclaration(config, binding), null, 2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
