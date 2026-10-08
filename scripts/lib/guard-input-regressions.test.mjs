import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	evaluateDelegationGuard,
	findOutwardCommand,
	splitCommandFlow,
} from "./delegation-guard.mjs";
import { evaluateMainCommitGuard } from "./main-commit-guard.mjs";

describe("opaque command selectors and executable prefixes", () => {
	for (const command of [
		'op=update-ref; git "$op" refs/heads/main HEAD',
		'git -C /repo "$OP" refs/heads/main HEAD',
		"git --$OPTION status",
		'group=pr; verb=merge; gh "$group" "$verb" 123',
		'gh -R "$REPO" pr "$VERB" 123',
		'gh api "$ENDPOINT" -X PUT',
		'gh api -X PUT "$ENDPOINT"',
		'gh api graphql -f query="$QUERY"',
		'/usr/bin/gh pr "$VERB" 123',
		'EMPTY=""; gh -R"$EMPTY" owner/repo pr merge 123',
		'EMPTY=""; env -u"$EMPTY" UNUSED git update-ref refs/heads/main HEAD',
		'EMPTY=""; git -c"$EMPTY" x=y update-ref refs/heads/main HEAD',
		'EMPTY=""; exec -a"$EMPTY" dummy gh pr merge 123',
		'EMPTY=""; sudo -u"$EMPTY" user gh pr merge 123',
		'EMPTY=""; time -f"$EMPTY" format gh pr merge 123',
		'EMPTY=""; gh pr merge -b"$EMPTY" --help',
		'gh -R"$REPO" pr view "$NUMBER"',
		`args=(owner/repo pr merge 123); gh -R "\${args[@]}"`,
		`args=(UNUSED git update-ref refs/heads/main HEAD); env -u "\${args[@]}"`,
		`args=(x=y update-ref refs/heads/main HEAD); git -c "\${args[@]}"`,
		'gh -R "$@"',
		"env -u $OPTIONS",
		"git -c $OPTIONS status",
		"env -S 'git commit -m x'",
		"env --split-string='gh pr merge 123'",
		"env -Sgit update-ref refs/heads/main HEAD",
		"env --ignore-signal=PIPE gh api -X PUT repos/O/R/pulls/123/merge",
		"env --ignore-signal=PIPE git update-ref refs/heads/main HEAD",
		'env "$OPTIONS" git commit -m x',
	]) {
		it(`rejects an unresolved invocation in every caller: ${command}`, () => {
			const payload = { tool_name: "Bash", tool_input: { command } };
			assert.equal(
				evaluateDelegationGuard(payload, { supportsAsk: false }).decision,
				"deny",
			);
			assert.equal(
				evaluateDelegationGuard(
					{ ...payload, agent_id: "child" },
					{ supportsAsk: false },
				).decision,
				"deny",
			);
			assert.equal(
				evaluateMainCommitGuard(payload, { currentBranch: "main" }).decision,
				"deny",
			);
		});
	}
	it("recognizes nohup's option terminator and actual shell command positions", () => {
		for (const command of [
			"nohup -- git commit -m x",
			"exec git commit -m x",
			"if git commit -m x; then :; fi",
		]) {
			const payload = { tool_name: "Bash", tool_input: { command } };
			assert.equal(
				evaluateDelegationGuard(
					{ ...payload, agent_id: "child" },
					{ supportsAsk: false },
				).decision,
				"deny",
				command,
			);
			assert.equal(
				evaluateMainCommitGuard(payload, { currentBranch: "main" }).decision,
				"deny",
				command,
			);
		}
	});
	it("keeps ordinary dynamic option values and literal read commands usable", () => {
		for (const command of [
			'git log -1 --format="$FORMAT"',
			'git --config-env=core.pager="$PAGER_ENV" log -1',
			'git -c "user.name=$NAME" log -1',
			'gh -R "$REPO" pr view "$NUMBER"',
			'gh --repo="$REPO" pr view "$NUMBER"',
			"env -i nohup -- git status",
			"env -u UNUSED git status",
			'gh pr create --title "$TITLE" --body "$BODY"',
		]) {
			const payload = { tool_name: "Bash", tool_input: { command } };
			assert.equal(evaluateDelegationGuard(payload).decision, "allow", command);
		}
	});
});

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
		assert.equal(
			findOutwardCommand("cat <<'EOF'\ngit push"),
			"unsupported shell syntax",
		);
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
		assert.equal(
			findOutwardCommand("bash <<'EOF'\ngit push\nEOF"),
			"unsupported shell syntax",
		);
		assert.equal(
			findOutwardCommand("sudo env sh <<'EOF'\ngit push\nEOF"),
			"unsupported shell syntax",
		);
		assert.equal(
			findOutwardCommand("bash --rcfile -c <<'EOF'\ngit push\nEOF"),
			"unsupported shell syntax",
		);
	});
	it("handles delimiter continuation, quoted backslashes and literal-dollar delimiters", () => {
		assert.equal(
			findOutwardCommand("cat <<EOF\ndata\nEO\\\nF\ngit push"),
			"unsupported shell syntax",
		);
		assert.equal(
			findOutwardCommand('cat <<"\\EOF"\ndata\n\\EOF\ngit push'),
			"git push",
		);
		assert.equal(
			findOutwardCommand("cat <<$END\ndata\n$END\ngit push"),
			"unsupported shell syntax",
		);
	});
	it("does not hide commands after ANSI-C quoted delimiters", () => {
		assert.equal(
			findOutwardCommand("cat <<$'EOF'\ndata\nEOF\ngit push"),
			"git push",
		);
		assert.equal(
			findOutwardCommand("cat <<$'\\x45OF'\ndata\nEOF\ngit push"),
			"unsupported shell syntax",
		);
		assert.equal(
			findOutwardCommand("cat <<$'\\400'\ndata\n\ngit push"),
			"unsupported shell syntax",
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
	it("recognizes label help after label-specific flags", () => {
		for (const command of [
			"gh label create flow:managed --color 1D76DB --help",
			"gh label create flow:managed --description 'Managed work' --force --help",
			"gh label edit flow:managed --color=1D76DB --name flow:tracked --help",
			"gh label create x -c 1D76DB -d text -f --help",
			"gh label edit x -n y -d text --help",
		])
			assert.equal(findOutwardCommand(command), null, command);
	});
	it("keeps label flag values and positional help as data", () => {
		for (const command of [
			"gh label create x --description --help",
			"gh label edit x --color --help",
			"gh label create x --color=--help",
			"gh label create x --description=--help",
			"gh label create x -d --help",
			"gh api -f --help",
			"gh label create x --force -- --help",
			"gh issue create --color --help",
		])
			assert.notEqual(findOutwardCommand(command), null, command);
	});
	for (const command of [
		"gh issue edit 1 --add-label x --help",
		"gh issue close 1 --reason completed --help",
		"gh pr edit 1 --add-reviewer x --help",
		"gh release create v1 --notes x --help",
		"gh repo create x --public --help",
		"gh label clone a/b --force --help",
		"gh repo create x -c -d text -h https://example.com --help",
		"gh release create v1 -d -p --generate-notes --help",
	])
		it(`allows command-specific help: ${command}`, () =>
			assert.equal(findOutwardCommand(command), null));
	for (const command of [
		"gh issue edit 1 --add-label --help",
		"gh issue close 1 --reason --help",
		"gh pr edit 1 --add-reviewer --help",
		"gh release create v1 --notes --help",
		"gh repo create x -h --help",
		"gh repo create x -d --help",
		"gh label clone a/b --force -- --help",
	])
		it(`keeps command flag data protected: ${command}`, () =>
			assert.notEqual(findOutwardCommand(command), null));
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

for (const command of ["echo $[1<<2]\ngit push"]) {
	it(`stops unsupported document syntax: ${JSON.stringify(command)}`, () =>
		assert.equal(
			evaluateMainCommitGuard(
				{ tool_name: "Bash", tool_input: { command } },
				{ currentBranch: "main" },
			).decision,
			"deny",
		));
}

it("does not turn literal text in a substitution heredoc into an executable command", () =>
	assert.equal(findOutwardCommand("echo $(cat <<b)\ngit push\nb"), null));

it("keeps literal text in a backtick heredoc as data", () =>
	assert.equal(findOutwardCommand("x=`cat <<b`\ngit push\nb"), null));
