import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	advisoryKey,
	formatPreArtifactAdvisory,
	isImplementationArtifactWrite,
	runPreArtifactAdvisory,
} from "./pre-artifact-advisory.mjs";

/** The repo root every payload below is placed against. */
const ROOT = "/repo";

const REMINDERS = [
	{
		name: "偽と分かった主張を、同じ形のまま中身だけ差し替える trap",
		path: ".pfdsl/bindings/pfd-retro-patterns/claim-form-invites-restaleness.md",
		countermeasure: "外部の能力に依存する規則は、その能力を列挙しない。",
	},
];

/** A stub session store that starts empty. */
function store() {
	const fired = new Set();
	return {
		hasFired: (key) => fired.has(key),
		markFired: (key) => fired.add(key),
		fired,
	};
}

function payload(overrides = {}) {
	return {
		hook_event_name: "PostToolUse",
		tool_name: "Edit",
		session_id: "s1",
		tool_input: {
			file_path: "/repo/scripts/lib/thing.mjs",
			old_string: "",
			new_string: "export const x = 1;\n",
		},
		...overrides,
	};
}

describe("isImplementationArtifactWrite", () => {
	it("flags a write under packages/", () => {
		assert.equal(
			isImplementationArtifactWrite(
				payload({
					tool_name: "Write",
					tool_input: {
						file_path: "/repo/packages/core/src/a.ts",
						content: "",
					},
				}),
				ROOT,
			),
			true,
		);
	});

	it("flags a write under scripts/", () => {
		assert.equal(isImplementationArtifactWrite(payload(), ROOT), true);
	});

	it("ignores prose living under those directories", () => {
		assert.equal(
			isImplementationArtifactWrite(
				payload({
					tool_input: { file_path: "/repo/scripts/README.md", new_string: "x" },
				}),
				ROOT,
			),
			false,
		);
	});

	it("ignores a path outside the implementation directories", () => {
		assert.equal(
			isImplementationArtifactWrite(
				payload({
					tool_input: {
						file_path: "/repo/.pfdsl/roadmap.pfdsl",
						new_string: "x",
					},
				}),
				ROOT,
			),
			false,
		);
	});

	it("ignores a tool that is not a write", () => {
		assert.equal(
			isImplementationArtifactWrite(payload({ tool_name: "Read" }), ROOT),
			false,
		);
	});

	it("ignores an implementation-shaped path in another checkout", () => {
		assert.equal(
			isImplementationArtifactWrite(
				payload({
					tool_input: { file_path: "/elsewhere/scripts/build.mjs" },
				}),
				ROOT,
			),
			false,
		);
	});

	it("ignores a vendored path that carries the directory names inside it", () => {
		assert.equal(
			isImplementationArtifactWrite(
				payload({
					tool_input: {
						file_path: "/repo/node_modules/lib/packages/x/index.js",
					},
				}),
				ROOT,
			),
			false,
		);
	});

	it("ignores a relative path, which cannot be placed against the root", () => {
		assert.equal(
			isImplementationArtifactWrite(
				payload({ tool_input: { file_path: "scripts/a.mjs" } }),
				ROOT,
			),
			false,
		);
	});
});

describe("advisoryKey", () => {
	it("scopes a delegate apart from its caller", () => {
		assert.notEqual(
			advisoryKey({ session_id: "s" }),
			advisoryKey({ session_id: "s", agent_id: "a" }),
		);
	});

	it("does not let a separator inside an id alias two scopes", () => {
		assert.notEqual(
			advisoryKey({ session_id: "a:b" }),
			advisoryKey({ session_id: "a", agent_id: "b" }),
		);
	});

	it("treats an agent_id that is not a usable string as the caller", () => {
		const caller = advisoryKey({ session_id: "s" });
		for (const agent_id of ["", null, 7, {}, undefined]) {
			assert.equal(advisoryKey({ session_id: "s", agent_id }), caller);
		}
	});

	it("gives a second cycle of one session its own fire", () => {
		assert.notEqual(
			advisoryKey({ session_id: "s" }, "cycle-1"),
			advisoryKey({ session_id: "s" }, "cycle-2"),
		);
	});

	it("keeps one cycle's scope stable across writes", () => {
		assert.equal(
			advisoryKey({ session_id: "s" }, "cycle-1"),
			advisoryKey({ session_id: "s" }, "cycle-1"),
		);
	});

	it("still separates caller and delegate within one cycle", () => {
		assert.notEqual(
			advisoryKey({ session_id: "s" }, "cycle-1"),
			advisoryKey({ session_id: "s", agent_id: "a" }, "cycle-1"),
		);
	});

	it("falls back to a session-wide scope when the cycle cannot be identified", () => {
		assert.equal(
			advisoryKey({ session_id: "s" }, null),
			advisoryKey({ session_id: "s" }, null),
		);
		assert.notEqual(
			advisoryKey({ session_id: "s" }, null),
			advisoryKey({ session_id: "s" }, "cycle-1"),
		);
	});

	it("returns null when there is no session to scope to", () => {
		assert.equal(advisoryKey({ agent_id: "a" }), null);
		assert.equal(advisoryKey({ session_id: "" }), null);
		assert.equal(advisoryKey({}), null);
	});
});

describe("formatPreArtifactAdvisory", () => {
	it("names every reminder and its file", () => {
		const text = formatPreArtifactAdvisory(REMINDERS);
		assert.match(text, /claim-form-invites-restaleness\.md/);
		assert.match(text, /同じ形のまま中身だけ差し替える/);
	});

	it("tells the runner the artifact already landed, rather than claiming to precede it", () => {
		const text = formatPreArtifactAdvisory(REMINDERS);
		assert.doesNotMatch(text, /what you are writing/);
		assert.match(text, /already on disk/);
		assert.match(text, /Re-read what you just wrote/);
	});

	it("leaves the countermeasure to the preflight, which can afford the length", () => {
		assert.doesNotMatch(
			formatPreArtifactAdvisory(REMINDERS),
			/外部の能力に依存する規則/,
		);
	});
});

describe("runPreArtifactAdvisory", () => {
	it("fires on the first implementation write of a session", () => {
		const s = store();
		const { shouldOutput, output } = runPreArtifactAdvisory(
			JSON.stringify(payload()),
			{
				root: ROOT,
				cycleId: () => "cycle-1",
				loadReminders: () => REMINDERS,
				...s,
			},
		);
		assert.equal(shouldOutput, true);
		assert.match(
			output.hookSpecificOutput.additionalContext,
			/claim-form-invites-restaleness/,
		);
	});

	it("marks the session so the second write stays quiet", () => {
		const s = store();
		const io = {
			root: ROOT,
			cycleId: () => "cycle-1",
			loadReminders: () => REMINDERS,
			...s,
		};
		runPreArtifactAdvisory(JSON.stringify(payload()), io);
		const second = runPreArtifactAdvisory(JSON.stringify(payload()), io);
		assert.equal(second.shouldOutput, false);
	});

	it("gives a delegate its own fire, since parent and subagent share session_id", () => {
		const s = store();
		const io = {
			root: ROOT,
			cycleId: () => "cycle-1",
			loadReminders: () => REMINDERS,
			...s,
		};
		runPreArtifactAdvisory(JSON.stringify(payload()), io);
		const delegate = runPreArtifactAdvisory(
			JSON.stringify(payload({ agent_id: "agent-1" })),
			io,
		);
		assert.equal(delegate.shouldOutput, true);
	});

	it("still fires only once for a given delegate", () => {
		const s = store();
		const io = {
			root: ROOT,
			cycleId: () => "cycle-1",
			loadReminders: () => REMINDERS,
			...s,
		};
		const withAgent = JSON.stringify(payload({ agent_id: "agent-1" }));
		runPreArtifactAdvisory(withAgent, io);
		assert.equal(runPreArtifactAdvisory(withAgent, io).shouldOutput, false);
	});

	it("keeps two delegates of one session apart", () => {
		const s = store();
		const io = {
			root: ROOT,
			cycleId: () => "cycle-1",
			loadReminders: () => REMINDERS,
			...s,
		};
		runPreArtifactAdvisory(
			JSON.stringify(payload({ agent_id: "agent-1" })),
			io,
		);
		const other = runPreArtifactAdvisory(
			JSON.stringify(payload({ agent_id: "agent-2" })),
			io,
		);
		assert.equal(other.shouldOutput, true);
	});

	it("fires again for the next cycle of the same session", () => {
		const s = store();
		let cycle = "cycle-1";
		const io = {
			root: ROOT,
			cycleId: () => cycle,
			loadReminders: () => REMINDERS,
			...s,
		};
		runPreArtifactAdvisory(JSON.stringify(payload()), io);
		cycle = "cycle-2";
		assert.equal(
			runPreArtifactAdvisory(JSON.stringify(payload()), io).shouldOutput,
			true,
		);
	});

	it("still speaks when the cycle cannot be read, rather than letting the write throw", () => {
		const s = store();
		const { shouldOutput } = runPreArtifactAdvisory(JSON.stringify(payload()), {
			root: ROOT,
			cycleId: () => {
				throw new Error("not a git repository");
			},
			loadReminders: () => REMINDERS,
			...s,
		});
		assert.equal(shouldOutput, true);
	});

	it("keys the mark per session, so a different session still gets it", () => {
		const s = store();
		const io = {
			root: ROOT,
			cycleId: () => "cycle-1",
			loadReminders: () => REMINDERS,
			...s,
		};
		runPreArtifactAdvisory(JSON.stringify(payload()), io);
		const other = runPreArtifactAdvisory(
			JSON.stringify(payload({ session_id: "s2" })),
			io,
		);
		assert.equal(other.shouldOutput, true);
	});

	it("stays quiet when the payload carries no session id to dedupe on", () => {
		const s = store();
		const { shouldOutput } = runPreArtifactAdvisory(
			JSON.stringify(payload({ session_id: undefined })),
			{
				root: ROOT,
				cycleId: () => "cycle-1",
				loadReminders: () => REMINDERS,
				...s,
			},
		);
		assert.equal(shouldOutput, false);
	});

	it("stays quiet, without marking, when the catalog yields no pre-artifact pattern", () => {
		const s = store();
		const { shouldOutput } = runPreArtifactAdvisory(JSON.stringify(payload()), {
			root: ROOT,
			cycleId: () => "cycle-1",
			loadReminders: () => [],
			...s,
		});
		assert.equal(shouldOutput, false);
		assert.equal(s.fired.size, 0);
	});

	it("stays quiet when the catalog cannot be read", () => {
		const s = store();
		const { shouldOutput } = runPreArtifactAdvisory(JSON.stringify(payload()), {
			root: ROOT,
			cycleId: () => "cycle-1",
			loadReminders: () => {
				throw new Error("no catalog");
			},
			...s,
		});
		assert.equal(shouldOutput, false);
	});

	it("still speaks when the session cannot be marked, rather than letting the write throw", () => {
		const s = store();
		const { shouldOutput } = runPreArtifactAdvisory(JSON.stringify(payload()), {
			root: ROOT,
			cycleId: () => "cycle-1",
			loadReminders: () => REMINDERS,
			...s,
			markFired: () => {
				throw new Error("EROFS: read-only file system");
			},
		});
		assert.equal(shouldOutput, true);
	});

	it("stays quiet on a malformed payload", () => {
		const s = store();
		const { shouldOutput } = runPreArtifactAdvisory("not json", {
			loadReminders: () => REMINDERS,
			...s,
		});
		assert.equal(shouldOutput, false);
	});
});
