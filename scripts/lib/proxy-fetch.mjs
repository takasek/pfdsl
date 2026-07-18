/**
 * A fetch-compatible function that transparently works behind this
 * environment's HTTPS_PROXY. Node's built-in fetch (undici) doesn't honor
 * HTTP_PROXY/HTTPS_PROXY env vars unless the process itself was started
 * with --use-env-proxy (see /root/.ccr/README.md) — but a script already
 * running as `node scripts/foo.mjs` can't retroactively add that flag to
 * itself. Instead, each request behind a proxy is delegated to a
 * short-lived child node process started with the flag.
 *
 * When no proxy is configured, falls straight through to the global fetch
 * with no extra process spawned.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const WORKER_SCRIPT = fileURLToPath(new URL("./proxy-fetch-worker.mjs", import.meta.url));

/**
 * @type {typeof fetch}
 */
export async function proxyAwareFetch(url, init = {}) {
	if (!process.env.HTTPS_PROXY && !process.env.https_proxy) {
		return fetch(url, init);
	}
	const request = { url: String(url), method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body };
	const out = execFileSync(process.execPath, ["--use-env-proxy", WORKER_SCRIPT], {
		input: JSON.stringify(request),
		encoding: "utf-8",
		maxBuffer: 64 * 1024 * 1024,
	});
	const { ok, status, bodyText } = JSON.parse(out);
	return { ok, status, json: async () => JSON.parse(bodyText), text: async () => bodyText };
}
