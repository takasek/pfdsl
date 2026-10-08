#!/usr/bin/env node
import { installShellParser } from "./lib/shell-parser-tool.mjs";

await installShellParser(process.cwd());
