#!/usr/bin/env node
// One-shot HTTP request, run with --use-env-proxy so Node's built-in fetch
// honors HTTPS_PROXY (it doesn't by default — see /root/.ccr/README.md).
// Reads a {url, method, headers, body} JSON request from stdin, writes
// {ok, status, bodyText} JSON to stdout. Spawned by proxy-fetch.mjs.

import { readFileSync } from "node:fs";

const { url, method, headers, body } = JSON.parse(readFileSync(0, "utf-8"));
const res = await fetch(url, { method, headers, body });
const bodyText = await res.text();
process.stdout.write(JSON.stringify({ ok: res.ok, status: res.status, bodyText }));
