import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPushChain } from "./push-check-chain.mjs";

const unsafe = [
	"make test; git push",
	"make test | tail -1; git push",
	"make test\ngit push",
	"make test || git push",
	"make test | git push",
	"make test && echo done; git push",
	"make test; make typecheck && git push",
	'make build x; make test x; echo "test=$?"; make typecheck; git push',
	"make -C /tmp/repo test; git -C /tmp/repo push origin HEAD",
	"make lint; git push",
	"make check-docs; git push",
	"node --test example.test.mjs; git push",
	"pnpm --filter core test; git push",
	"pnpm -r run test; git push",
	"pnpm typecheck; git push",
	"pnpm --filter core typecheck; git push",
	"pnpm -r run typecheck; git push",
	"CHECK=1 make test; command git push",
	"make test | tail -1 && git push",
	"! make test && git push",
	"make -j test; git push",
	"make --jobs test; git push",
	"make -j 2 test; git push",
	"make test; git --config-env core.sshCommand=GIT_SSH_COMMAND push",
];
for (const command of unsafe) {
	test(`denies ${JSON.stringify(command)}`, () => {
		const result = checkPushChain(command);
		assert.equal(result?.decision, "deny");
		assert.match(result.reason, /&&/);
	});
}

for (const command of [
	"make test && make typecheck && git push",
	"pnpm typecheck && git push",
	"pnpm --filter core run typecheck && git push",
	"make test &&\n git push",
	"make test && echo 'literal ; | ||' && git push",
	"make test > /tmp/test.log 2>&1 && git push",
	"make test && # results must succeed\n git push",
	"make test \\\n && git push",
	"make test && echo 日本語 && git push",
	"git push",
	"git merge branch && git push",
	"make build; git push",
	"echo 'make test; git push'",
	"printf '%s' 'make test'; git push",
	"git push; make test",
	"make test; git status",
	"pnpm add test; git push",
	"make test-data; git push",
]) {
	test(`allows ${JSON.stringify(command)}`, () => {
		assert.equal(checkPushChain(command), null);
	});
}
