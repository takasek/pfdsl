import assert from "node:assert/strict";
import { test } from "node:test";
import { createCloseGuard } from "../src/close-guard.ts";

test("blocks dirty close before waiting and suppresses repeated requests", async () => {
	let resolve;
	let requests = 0;
	let prevented = 0;
	const guard = createCloseGuard(() => {
		requests++;
		return new Promise((done) => {
			resolve = done;
		});
	});
	const event = {
		preventDefault() {
			prevented++;
		},
	};
	const pending = guard(event, true);
	assert.equal(prevented, 1);
	await guard(event, true);
	assert.equal(prevented, 2);
	assert.equal(requests, 1);
	resolve();
	await pending;
	const retry = guard(event, true);
	assert.equal(requests, 2);
	resolve();
	await retry;
});

test("does not prompt on clean close; failed confirmation leaves closing blocked", async () => {
	let prevented = 0;
	let requests = 0;
	const guard = createCloseGuard(async () => {
		requests++;
		throw new Error("Native confirmation failed");
	});
	const event = {
		preventDefault() {
			prevented++;
		},
	};
	await guard(event, false);
	assert.equal(requests, 0);
	assert.equal(prevented, 0);
	await assert.rejects(guard(event, true), /Native confirmation failed/);
	assert.equal(prevented, 1);
	await assert.rejects(guard(event, true), /Native confirmation failed/);
	assert.equal(prevented, 2);
});
