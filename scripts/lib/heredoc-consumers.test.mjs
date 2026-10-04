import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findOutwardCommand, splitCommandFlow } from "./delegation-guard.mjs";
import {
	evaluateMainCommitGuard,
	runMainCommitGuard,
} from "./main-commit-guard.mjs";

// A heredoc body is data only when the command that reads it is known to treat
// stdin as data. Every other reader may execute it, so its body stays visible to
// the guards. `<<D` marks where each delimiter form is substituted.
const DELIMITERS = ["EOF", "'EOF'", '"EOF"', "\\EOF"];
const DATA_READERS = [
	"cat <<D",
	"cat > out.txt <<D",
	"cat <<D >> out.txt",
	"tee out.txt <<D",
	"git commit -F - <<D",
	"git commit --file=- <<D",
	"git commit --file - <<D",
	"git tag -a v1 -F - <<D",
	"gh pr create --title t --body-file - <<D",
	"gh issue comment 1 -F - <<D",
	"gh api repos/o/r/issues --input - <<D",
	"cat <<D | gh pr create --title t --body-file -",
];
const CODE_OR_UNKNOWN_READERS = [
	"bash <<D",
	"sh <<D",
	"bash -euo pipefail <<D",
	"bash -xO extglob <<D",
	"bash +o posix <<D",
	"bash /dev/stdin <<D",
	"bash /dev/fd/0 <<D",
	"bash - <<D",
	"sh -c bash <<D",
	"timeout 60 bash <<D",
	"exec bash <<D",
	"nice -n 5 bash <<D",
	"env -S bash <<D",
	"sudo -s <<D",
	"{ bash; } <<D",
	'while read -r l; do bash -c "$l"; done <<D',
	"source /dev/stdin <<D",
	"python3 - <<D",
	"node <<D",
	"make -f - <<D",
	"frobnicate <<D",
	"cat <<D |",
	"cat <<D &&",
	"cat <<D | bash",
	"exec <<D",
];

const segments = (command) =>
	splitCommandFlow(command).map(({ command: text }) => text.trim());
const withBody = (template, delimiter, body) =>
	`${template.replace("<<D", `<<${delimiter}`)}\n${body}\nEOF\nbash`;

describe("heredoc readers", () => {
	for (const template of DATA_READERS)
		for (const delimiter of DELIMITERS)
			it(`hides the body read by ${template} with ${delimiter}`, () => {
				const command = withBody(template, delimiter, "git push\ngit add -A");
				const visible = segments(command);
				assert.equal(visible.includes("git push"), false, visible.join(" ⏎ "));
				assert.equal(visible.includes("git add -A"), false);
			});
	for (const template of CODE_OR_UNKNOWN_READERS)
		for (const delimiter of DELIMITERS)
			it(`keeps the body read by ${template} with ${delimiter} visible`, () => {
				assert.equal(
					findOutwardCommand(withBody(template, delimiter, "git push")),
					"git push",
				);
				assert.equal(
					evaluateMainCommitGuard(
						{
							tool_name: "Bash",
							tool_input: {
								command: withBody(template, delimiter, "git add -A"),
							},
						},
						{ currentBranch: "main" },
					).decision,
					"deny",
				);
			});
	it("leaves Git after a body some program may run unresolved (split the call)", () => {
		const decide = (command) =>
			runMainCommitGuard(
				JSON.stringify({
					tool_name: "Bash",
					cwd: "/repo/feature",
					tool_input: { command },
				}),
				{
					resolveBranches: () => ({
						currentBranch: "feature",
						mainBranch: "main",
						targetRelation: "own",
					}),
				},
			).output?.hookSpecificOutput?.permissionDecision ?? "allow";
		assert.equal(
			decide("python3 - <<'EOF'\nprint(1)\nEOF\ngit add -A"),
			"deny",
		);
		assert.equal(decide("cat > f <<'EOF'\nx\nEOF\ngit add -A"), "allow");
	});
	it("lets a commit message mention guarded commands (#1280)", () => {
		const command =
			"git commit -F - <<'EOF'\nfix: x\n\ngit add foo\ngh label create foo\nEOF";
		assert.equal(findOutwardCommand(command), null);
		assert.equal(
			evaluateMainCommitGuard(
				{ tool_name: "Bash", tool_input: { command } },
				{ currentBranch: "feature" },
			).decision,
			"allow",
		);
	});
});

// A << that the scanner cannot place outside every quote and expansion is not
// a document start it can trust; everything after it stays visible.
describe("ambiguous document starts", () => {
	for (const command of [
		"echo $[1<<2]\ngit push",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion, not JavaScript interpolation
		"echo ${x:-a<<b}\ngit push",
		"echo $((1<<2))\ngit push",
		'echo "$(cat <<\'EOF\'\nsay "hi <<X" now\nEOF\n)"\ngit push',
		'git commit -m "$(cat <<\'EOF\'\nfix: treat "cat <<EOF" bodies as data\nEOF\n)"\ngit push',
		"echo $(cat <<b)\ngit push\nb",
		"x=`cat <<b`\ngit push\nb",
	])
		it(`keeps later commands visible: ${JSON.stringify(command)}`, () =>
			assert.equal(findOutwardCommand(command), "git push"));
});
