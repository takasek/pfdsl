#!/usr/bin/env node
// Usage: node scripts/mutation-check.mjs --config <json-file>
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { checkMutation } from "./lib/mutation-check.mjs";

let result;
try {
	const { values } = parseArgs({
		options: { config: { type: "string" } },
		strict: true,
		allowPositionals: false,
	});
	if (!values.config)
		throw new Error(
			"Usage: node scripts/mutation-check.mjs --config <json-file>",
		);
	result = await checkMutation(JSON.parse(readFileSync(values.config, "utf8")));
} catch (error) {
	result = { status: "error", exitCode: 1, reason: error.message };
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.exitCode;
