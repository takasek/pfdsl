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
