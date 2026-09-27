import { writeFile } from "node:fs/promises";
import { FRONTMATTER_JSON_SCHEMA } from "../dist/json-schema.js";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--source")) {
	throw new Error("Usage: node scripts/write-schema.mjs [--source]");
}
const target =
	args[0] === "--source"
		? "../schema/frontmatter.schema.json"
		: "../dist/frontmatter.schema.json";
await writeFile(
	new URL(target, import.meta.url),
	`${JSON.stringify(FRONTMATTER_JSON_SCHEMA, null, 2)}\n`,
);
