import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AGENT_OPERATION_INPUT_FORMS } from "./agent-operation-input-forms.mjs";

test("option representation retains every pre-compaction name, arity, count and role", () => {
	const snapshot = JSON.parse(
		readFileSync(
			new URL(
				"./__fixtures__/agent-operation-option-snapshot.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	assert.equal(Object.keys(AGENT_OPERATION_INPUT_FORMS).length, snapshot.forms);
	assert.equal(
		Object.values(AGENT_OPERATION_INPUT_FORMS).reduce(
			(total, form) => total + Object.keys(form).length,
			0,
		),
		snapshot.options,
	);
	assert.equal(
		createHash("sha256")
			.update(JSON.stringify(AGENT_OPERATION_INPUT_FORMS))
			.digest("hex"),
		snapshot.hash,
	);
});

test("compact JSON keeps one complete subcommand per line", () => {
	const text = readFileSync(
		new URL("./agent-operation-option-table.json", import.meta.url),
		"utf8",
	);
	const table = JSON.parse(text);
	const names = Object.keys(table);
	const lines = text.trimEnd().split("\n");
	assert.equal(lines.length, names.length + 2);
	for (const [index, line] of lines.slice(1, -1).entries()) {
		const form = JSON.parse(`{${line.trim().replace(/,$/, "")}}`);
		assert.deepEqual(Object.keys(form), [names[index]]);
		assert.deepEqual(form[names[index]], table[names[index]]);
	}
});
