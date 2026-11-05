#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { isCliEntrypoint } from "./lib/cli-entrypoint.mjs";
import { installShellParser } from "./lib/shell-parser-tool.mjs";

// Repair the checkout that owns this installer, even when the harness cwd moves.
export const SHELL_PARSER_ROOT = fileURLToPath(new URL("../", import.meta.url));

if (isCliEntrypoint(import.meta.url, process.argv[1]))
	await installShellParser(SHELL_PARSER_ROOT);
