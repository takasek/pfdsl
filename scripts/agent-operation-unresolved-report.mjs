#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { summarizeUnresolvedRecords } from "./lib/agent-operation-unresolved.mjs";
import { resolveGitRoots } from "./lib/run-exec.mjs";

const roots = resolveGitRoots(process.cwd());
if (!roots) throw new Error("Cannot determine the Git common directory.");
let text = "";
try {
	text = readFileSync(
		join(roots.commonDir, "pfdsl/agent-operation-unresolved.jsonl"),
		"utf8",
	);
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}
console.log(JSON.stringify(summarizeUnresolvedRecords(text), null, 2));
