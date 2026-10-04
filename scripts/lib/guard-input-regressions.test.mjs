import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findOutwardCommand, splitCommandFlow } from "./delegation-guard.mjs";
import { evaluateMainCommitGuard } from "./main-commit-guard.mjs";

describe("heredoc command boundaries", () => {
	for (const delimiter of ["EOF", "'EOF'", '"EOF"', "E'O'F", "\\EOF"]) {
		it(`keeps literal input out of commands with ${delimiter}`, () => {
			const command = `cat <<${delimiter}\ngit push\ngit commit --no-verify\nEOF\ngit status`;
			assert.equal(findOutwardCommand(command), null);
			assert.equal(
				evaluateMainCommitGuard(
					{ tool_name: "Bash", tool_input: { command } },
					{ currentBranch: "main" },
				).decision,
				"allow",
			);
			assert.equal(splitCommandFlow(command).at(-1).command, "git status");
		});
	}
	it("consumes multiple pending documents, tab stripping, and EOF input", () => {
		assert.equal(
			findOutwardCommand(
				"cat <<A <<-B\ngit push\nA\n\tgh pr create\n\tB\ngit status",
			),
			null,
		);
		assert.equal(findOutwardCommand("cat <<'EOF'\ngit push"), null);
	});
	it("still inspects real commands after and on the heredoc header", () => {
		assert.equal(
			findOutwardCommand("cat <<'EOF' | git push\ndata\nEOF"),
			"git push",
		);
		assert.equal(
			findOutwardCommand("cat <<EOF\ndata\nEOF\ngit push"),
			"git push",
		);
	});
	it("inspects executable expansions but respects delimiter quoting and escapes", () => {
		assert.equal(findOutwardCommand("cat <<EOF\n$(git push)\nEOF"), "git push");
		assert.equal(findOutwardCommand("cat <<EOF\n`git push`\nEOF"), "git push");
		assert.equal(findOutwardCommand("cat <<'EOF'\n$(git push)\nEOF"), null);
		assert.equal(findOutwardCommand("cat <<EOF\n\\$(git push)\nEOF"), null);
		assert.equal(
			findOutwardCommand('cat <<EOF\n$(echo "$(git push)")\nEOF'),
			"git push",
		);
		assert.equal(
			findOutwardCommand("cat <<EOF\n$(echo '$(git push)')\nEOF"),
			null,
		);
	});
	it("does not hide scripts passed to shell stdin", () => {
		assert.equal(findOutwardCommand("bash <<'EOF'\ngit push\nEOF"), "git push");
		assert.equal(
			findOutwardCommand("sudo env sh <<'EOF'\ngit push\nEOF"),
			"git push",
		);
		assert.equal(
			findOutwardCommand("bash --rcfile -c <<'EOF'\ngit push\nEOF"),
			"git push",
		);
	});
	it("keeps data passed to a shell -c command out of executable stdin", () => {
		assert.equal(findOutwardCommand("sh -c cat <<'EOF'\ngit push\nEOF"), null);
		assert.equal(
			findOutwardCommand("bash -lc cat <<'EOF'\ngit push\nEOF"),
			null,
		);
	});
	it("handles delimiter continuation, quoted backslashes and literal-dollar delimiters", () => {
		assert.equal(
			findOutwardCommand("cat <<EOF\ndata\nEO\\\nF\ngit push"),
			"git push",
		);
		assert.equal(
			findOutwardCommand('cat <<"\\EOF"\ndata\n\\EOF\ngit push'),
			"git push",
		);
		assert.equal(
			findOutwardCommand("cat <<$END\ndata\n$END\ngit push"),
			"git push",
		);
	});
	it("does not hide commands after ANSI-C quoted delimiters", () => {
		assert.equal(
			findOutwardCommand("cat <<$'EOF'\ndata\nEOF\ngit push"),
			"git push",
		);
		assert.equal(
			findOutwardCommand("cat <<$'\\x45OF'\ndata\nEOF\ngit push"),
			"git push",
		);
		assert.equal(
			findOutwardCommand("cat <<$'\\400'\ndata\n\ngit push"),
			"git push",
		);
		assert.equal(
			findOutwardCommand("cat <<EO\\\nF\n$(git push)\nEOF"),
			"git push",
		);
	});
	it("does not mistake here strings, comments or quoted operators for documents", () => {
		assert.equal(
			findOutwardCommand("cat <<< 'git push'\ngit push"),
			"git push",
		);
		assert.equal(findOutwardCommand("echo '<<EOF'\ngit push"), "git push");
		assert.equal(findOutwardCommand("# <<EOF\ngit push"), "git push");
		assert.equal(findOutwardCommand("((x << 2))\ngit push"), "git push");
		assert.equal(findOutwardCommand("echo $((x << 2))\ngit push"), "git push");
	});
});

describe("gh invocation effects", () => {
	it("keeps existing built-in list and view flows readable", () => {
		for (const command of [
			"gh extension list",
			"gh config list",
			"gh project view 1",
			"gh codespace list",
			"gh ssh-key list",
		])
			assert.equal(findOutwardCommand(command), null, command);
	});
	it("recognizes help after boolean merge and create flags", () => {
		for (const command of [
			"gh pr merge --squash --help",
			"gh pr merge -m --help",
			"gh pr create --draft=false --help",
		])
			assert.equal(findOutwardCommand(command), null, command);
	});
	for (const command of [
		"gh workflow disable --help",
		"gh help workflow",
		"gh search issues foo",
		"gh search code foo",
		"gh run watch 123",
		"gh browse --no-browser",
		"gh api -X POST --help",
	]) {
		it(`allows reading with ${command}`, () =>
			assert.equal(findOutwardCommand(command), null));
	}
	for (const command of [
		"gh workflow disable x",
		"gh issue create --title=--help",
		"gh issue create --title '--help'",
		"gh issue create --body -h",
		"gh issue create -- --help",
		"gh extension exec search",
		"gh frobnicate list",
		// gh binds -h to a value flag on some commands (gh 2.101: --homepage on
		// repo create/edit, --hostname on auth logout), so only --help is help.
		"gh repo create foo -h https://example.com --private",
		"gh repo edit -h https://example.com",
		"gh auth logout -h github.com",
		"gh issue create -h",
	]) {
		it(`does not infer help or read-only behavior from argument data: ${command}`, () =>
			assert.notEqual(findOutwardCommand(command), null));
	}
	it("classifies field-bearing API requests as POST unless GET is explicit", () => {
		assert.notEqual(
			findOutwardCommand("gh api repos/o/r/issues -f title=x"),
			null,
		);
		assert.notEqual(
			findOutwardCommand("gh api repos/o/r/issues --input body.json"),
			null,
		);
		assert.equal(
			findOutwardCommand("gh api repos/o/r/issues -X GET -f state=open"),
			null,
		);
		assert.notEqual(
			findOutwardCommand("gh api repos/o/r/issues --input '--method=GET'"),
			null,
		);
	});
});
