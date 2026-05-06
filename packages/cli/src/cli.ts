#!/usr/bin/env node
import { run } from "./index.js";

const argv = process.argv.slice(2);
const result = await run(argv);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.exitCode);
