import { tryGit } from "./run-exec.mjs";

// Guard-only budget: operational build/test runners retain their own limits.
export function createGuardProbe({
	exec = tryGit,
	now = Date.now,
	budget = 3000,
} = {}) {
	const deadline = now() + budget;
	return (args, opts = {}) => {
		const remaining = deadline - now();
		if (remaining <= 0) throw new Error("Git policy probe budget exhausted");
		const result = exec(args, {
			...opts,
			captureStderr: true,
			timeout: Math.min(500, remaining, opts.timeout ?? 500),
		});
		if (result.timedOut) throw new Error("Git policy probe timed out");
		return result;
	};
}
