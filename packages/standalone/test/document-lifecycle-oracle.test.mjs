// Counterexamples against the evidence oracle itself. Only recorded host
// events, editor/DOM observations and fake native bindings are supplied.
import assert from "node:assert/strict";
import test from "node:test";
import { FakeNative } from "./helpers/lifecycle-harness.mjs";
import {
	checkAction,
	checkObservation,
	checkPanel,
	checkReads,
} from "./helpers/lifecycle-invariants.mjs";

const capture = (run) => {
	const violations = [];
	run((tag, detail) => violations.push(`${tag}: ${detail}`));
	return violations;
};
const tabA = { getSource: () => "A0", setSourceCalls: 0 };
const tabB = { getSource: () => "B0", setSourceCalls: 0 };
const native = { docs: new Map() };

for (const why of ["open", "save", "approval"])
	test(`oracle U | B ${why} does not resolve A's read failure`, () => {
		const host = {
			log: [],
			isOpen: () => true,
			isDirty: () => false,
			ledger: {
				failures: [{ id: 1, seq: 2 }],
				received: [],
				acks: [{ id: 2, binding: "dir:b", content: "B0", why, seq: 3 }],
			},
		};
		const trace = {
			owned: [1],
			dirty0: false,
			name: "A",
			text0: "A0",
			setSource0: 0,
		};
		assert.ok(
			capture((violate) =>
				checkAction({ native, host, tab: tabA, trace, violate }),
			).some((v) => v.startsWith("U:")),
		);
	});

for (const gap of ["other tab save", "later decision", "same name"])
	test(`oracle T | close read gap after ${gap}`, () => {
		const host = {
			log: [
				{ kind: "confirm", tab: tabA, name: "A", seq: 2, decidedSeq: 3 },
				{ kind: "inspect", id: 1, binding: "dir:a", seq: 4, doneSeq: 5 },
				{
					kind: "confirm",
					tab: tabB,
					name: gap === "same name" ? "A" : "B",
					seq: 6,
					decidedSeq: 7,
				},
				...(gap === "other tab save"
					? [
							{
								kind: "save",
								tab: tabB,
								id: 2,
								binding: "dir:b",
								outcome: "saved",
								seq: 8,
							},
							{ kind: "inspect", id: 2, binding: "dir:b", seq: 9, doneSeq: 10 },
						]
					: []),
				{ kind: "dispose", tab: tabA, seq: 11 },
			],
			ledger: {
				received: [
					{ id: 1, binding: "dir:a" },
					{ id: 2, binding: "dir:b" },
				],
			},
		};
		const trace = { owned: [1], name: "A", seq0: 1 };
		assert.ok(
			capture((violate) =>
				checkReads({ host, tab: tabA, trace, violate }),
			).some((v) => v.startsWith("T:")),
		);
	});

test("oracle T | a same-binding new capability is a valid final read", () => {
	const host = {
		log: [
			{ kind: "confirm", tab: tabA, name: "A", seq: 2, decidedSeq: 3 },
			{ kind: "inspect", id: 9, binding: "dir:a", seq: 4, doneSeq: 5 },
			{ kind: "dispose", tab: tabA, seq: 6 },
		],
		ledger: {
			received: [
				{ id: 1, binding: "dir:a" },
				{ id: 1, unknown: true },
				{ id: 9, binding: "dir:a" },
			],
		},
	};
	assert.deepEqual(
		capture((violate) =>
			checkReads({
				host,
				tab: tabA,
				trace: { owned: [1], name: "A", seq0: 1 },
				violate,
			}),
		),
		[],
	);
});

test("oracle U | same-binding resolution survives an unknown receipt", () => {
	const host = {
		log: [],
		isOpen: () => true,
		isDirty: () => false,
		ledger: {
			failures: [{ id: 1, seq: 2 }],
			received: [
				{ id: 1, binding: "dir:a", seq: 1 },
				{ id: 1, unknown: true, seq: 3 },
			],
			acks: [{ id: 9, binding: "dir:a", content: "A0", why: "save", seq: 4 }],
		},
	};
	const trace = {
		owned: [1],
		dirty0: false,
		name: "A",
		text0: "A0",
		setSource0: 0,
	};
	assert.deepEqual(
		capture((violate) =>
			checkAction({ native, host, tab: tabA, trace, violate }),
		),
		[],
	);
});

for (const relation of ["same-binding", "hard-link"])
	for (const notice of [false, true])
		test(`oracle O | ${relation} | original notice: ${notice}`, () => {
			const fs = new FakeNative();
			const a = fs.add(1, "a.pfdsl", "A0");
			const b =
				relation === "same-binding"
					? fs.reselect(a, 9)
					: fs.link(a, 9, "alias.pfdsl");
			a.file.source = "external";
			const host = {
				panel: () => ({
					present: true,
					preview: "external",
					recoveryPath: b.path,
					originalAlsoChanged: notice,
				}),
				ledger: { acks: [{ id: 1, content: "A0" }] },
			};
			const violations = capture((violate) =>
				checkObservation({
					host,
					native: fs,
					original: a,
					recovery: b,
					violate,
				}),
			);
			assert.equal(
				violations.some((v) => v.startsWith("O:")),
				notice !== (relation === "hard-link"),
			);
		});

test("oracle P | an unresolved recovery requires a panel", () => {
	const host = { panel: () => ({ present: false }) };
	assert.ok(
		capture((violate) =>
			checkPanel({ host, native, recoveryId: 2, violate }),
		).some((v) => v.startsWith("P:")),
	);
});

test("oracle P | recorded unresolved recovery requires a panel without a target hint", () => {
	const host = {
		panel: () => ({ present: false }),
		activeTab: () => tabA,
		isOpen: () => true,
		ledger: {
			saves: [{ id: 1, tab: tabA, seq: 2, outcome: "conflict" }],
			acks: [],
		},
	};
	assert.ok(
		capture((violate) => checkPanel({ host, native, violate })).some((v) =>
			v.startsWith("P:"),
		),
	);
});
