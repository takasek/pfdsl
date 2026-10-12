import { Worker } from "node:worker_threads";

// Transplanted from dbcff6be. Threads retain the hook's process.ppid for
// native ownership while a stopped policy cannot stop this deadline.
export async function supervisePolicy(
	entryUrl,
	{ inputText, deadlineMs = 5000 } = {},
) {
	let finished = false;
	let worker;
	const fail = (detail) => {
		if (finished) return;
		finished = true;
		const reason = `Cannot execute the policy safely: ${String(detail).slice(0, 400)}. Repair the hook in a human terminal before retrying.`;
		console.error(reason);
		console.log(
			JSON.stringify({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: reason,
				},
			}),
		);
		process.exit(2);
	};
	const timer = setTimeout(
		() => fail("internal deadline exceeded"),
		deadlineMs,
	);
	try {
		let input = inputText;
		if (input === undefined) {
			const chunks = [];
			let bytes = 0;
			for await (const chunk of process.stdin) {
				bytes += Buffer.byteLength(chunk);
				if (bytes > 1024 * 1024) throw new Error("payload exceeds 1 MiB");
				chunks.push(Buffer.from(chunk));
			}
			input = Buffer.concat(chunks).toString("utf8");
		}
		if (typeof input !== "string" || Buffer.byteLength(input) > 1024 * 1024)
			throw new Error("invalid hook input size");
		const payload = JSON.parse(input);
		const toolInput = payload?.tool_input;
		if (
			!payload ||
			Array.isArray(payload) ||
			typeof payload.tool_name !== "string" ||
			!toolInput ||
			Array.isArray(toolInput) ||
			(typeof toolInput !== "object" &&
				!(
					payload.tool_name === "apply_patch" && typeof toolInput === "string"
				)) ||
			(["Bash", "exec_command"].includes(payload.tool_name) &&
				typeof (toolInput.command ?? toolInput.cmd) !== "string")
		)
			throw new Error("invalid hook payload");
		worker = new Worker(entryUrl, { stdin: true, stdout: true, stderr: true });
		let out = "",
			diagnostic = "";
		worker.stdout.on("data", (chunk) => {
			out += chunk;
			if (Buffer.byteLength(out) > 64 * 1024)
				fail("policy output exceeds 64 KiB");
		});
		worker.stderr.on("data", (chunk) => {
			diagnostic += chunk;
			if (Buffer.byteLength(diagnostic) > 64 * 1024)
				fail("policy diagnostic exceeds 64 KiB");
		});
		worker.on("error", (error) => fail(error.message));
		worker.on("exit", (code) => {
			if (finished) return;
			try {
				if (code !== 0 && code !== 2) throw new Error(`policy exited ${code}`);
				if (out.trim()) {
					const response = JSON.parse(out).hookSpecificOutput;
					if (
						!response ||
						response.hookEventName !== "PreToolUse" ||
						!["allow", "deny", "ask"].includes(response.permissionDecision) ||
						typeof response.permissionDecisionReason !== "string" ||
						(code === 2 && response.permissionDecision !== "deny")
					)
						throw new Error("unsupported policy response");
					// The table already maps Codex ask cells to deny. A stray ask
					// signals an invalid policy response, not a second conversion.
					if (
						response.permissionDecision === "ask" &&
						!process.env.CLAUDE_PROJECT_DIR?.trim()
					)
						throw new Error("Codex policy returned an unsupported ask");
				} else if (code === 2)
					throw new Error("policy failure without a deny response");
				finished = true;
				clearTimeout(timer);
				process.stderr.write(diagnostic);
				process.stdout.write(out);
				process.exit(code);
			} catch (error) {
				fail(error.message);
			}
		});
		worker.stdin.on("error", (error) => fail(error.message));
		worker.stdin.end(input);
		await new Promise(() => {});
	} catch (error) {
		fail(error.message);
	}
}
