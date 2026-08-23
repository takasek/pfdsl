import { spawnSync } from "node:child_process";

const separator = process.argv.indexOf("--");
const paths = process.argv.slice(separator + 1);
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
