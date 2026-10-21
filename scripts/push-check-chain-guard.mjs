#!/usr/bin/env node
// Development-only PreToolUse(Bash) guard; not part of the plugin bundle.
import {
	buildPermissionOutput,
	parseHookPayload,
	readStdinText,
} from "./lib/hook-io.mjs";
import { checkPushChain } from "./lib/push-check-chain.mjs";

const payload = parseHookPayload(await readStdinText());
if (payload?.tool_name === "Bash") {
	const result = checkPushChain(payload.tool_input?.command);
	if (result) console.log(JSON.stringify(buildPermissionOutput(result)));
}
