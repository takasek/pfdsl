// Usage: node scripts/check-generated-drift.mjs -- <pathspec>...
//        node scripts/check-generated-drift.mjs --gen-plugin <pre-commit|terminal|ci>
// The second form reads the pathspecs from the gen-plugin output contract (scripts/lib/gen-plugin-outputs.mjs), for callers such as a workflow step that cannot import it.
import { spawnSync } from "node:child_process";

import { genPluginDriftPathspecs } from "./lib/gen-plugin-outputs.mjs";

function requestedPaths(args) {
	if (args[0] === "--gen-plugin") return genPluginDriftPathspecs(args[1]);
	return args.slice(args.indexOf("--") + 1);
}

let paths;
try {
	paths = requestedPaths(process.argv.slice(2));
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
	process.exit(2);
}
const tracked = spawnSync("git", ["diff", "--quiet", "--", ...paths], {
	encoding: "utf8",
});

if (tracked.status === 1) {
	process.stderr.write("Tracked generated files differ from the index.\n");
	process.exit(1);
}
if (tracked.status !== 0) {
	process.stderr.write(tracked.stderr);
	process.exit(tracked.status ?? 1);
}

const untracked = spawnSync(
	"git",
	["ls-files", "--others", "--exclude-standard", "--", ...paths],
	{ encoding: "utf8" },
);

if (untracked.status !== 0) {
	process.stderr.write(untracked.stderr);
	process.exit(untracked.status ?? 1);
}

if (untracked.stdout !== "") {
	process.stderr.write(`Untracked generated files:\n${untracked.stdout}`);
	process.exit(1);
}
