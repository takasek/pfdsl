import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertTargetOutputClosure,
	capabilitiesForTarget,
	DELIVERY_TARGETS,
	validateCapabilityContract,
} from "./harness-capability-contract.mjs";
import { PROBE_FIXTURES } from "./harness-capability-probes.test-helper.mjs";
import { HARNESS_CAPABILITY_CONTRACT } from "./harness-inventory.mjs";

const probeKinds = new Set(["test-probe"]);

function assertProbeFixtureBindings(capabilities, fixtures) {
	const mappings = capabilities.flatMap((capability) =>
		(Array.isArray(capability.mappings)
			? capability.mappings
			: Object.values(capability.mappings ?? {})
		).map((mapping) => ({
			capability,
			mapping,
		})),
	);
	const declaredKinds = new Set();

	for (const { capability, mapping } of mappings) {
		if (!["native", "transform"].includes(mapping.disposition)) continue;
		const kind =
			typeof mapping.probe === "string" ? mapping.probe : mapping.probe?.kind;
		declaredKinds.add(kind);
		const fixture = fixtures[kind];
		assert.ok(fixture, `${capability.id}: missing probe fixture kind ${kind}`);
		assert.equal(typeof fixture.probe, "function", `${kind} probe`);
		if (fixture.target !== mapping.target) {
			throw new Error(
				`${capability.id}: ${mapping.target} mapping references ${kind} fixture for ${fixture.target}`,
			);
		}
	}

	for (const kind of Object.keys(fixtures)) {
		if (!declaredKinds.has(kind)) {
			throw new Error(`orphan probe fixture kind ${kind}`);
		}
	}
	assert.deepEqual(
		[...declaredKinds].sort(),
		Object.keys(fixtures).sort(),
		"probe fixture registry must cover exactly the declared probe kinds",
	);
}

function completeCapability() {
	return {
		id: "capability:test",
		kind: "command",
		source: { encoding: "test", path: "test" },
		semantic: { name: "test", description: "test", body: "test" },
		mappings: DELIVERY_TARGETS.map((target) => ({
			target,
			disposition: "native",
			outputs: ["surface:test"],
			probe: { kind: "test-probe" },
		})),
	};
}

function withoutMapping(capability, target) {
	return {
		...capability,
		mappings: capability.mappings.filter(
			(mapping) => mapping.target !== target,
		),
	};
}

function mappingFor(capability, target) {
	if (Array.isArray(capability.mappings)) {
		return capability.mappings.find((mapping) => mapping.target === target);
	}
	return capability.mappings[target];
}

function withMapping(capability, target, changes) {
	return {
		...capability,
		mappings: capability.mappings.map((mapping) =>
			mapping.target === target ? { ...mapping, ...changes } : mapping,
		),
	};
}

describe("harness capability contract", () => {
	it("keeps the probe fixture registry exactly aligned with native and transform mappings", () => {
		assertProbeFixtureBindings(HARNESS_CAPABILITY_CONTRACT, PROBE_FIXTURES);
	});

	it("rejects a mapping that references a fixture for another delivery target", () => {
		const capabilities = structuredClone(HARNESS_CAPABILITY_CONTRACT);
		const mapping = capabilities
			.find(({ id }) => id === "skill:pfd-ops")
			.mappings.find(({ target }) => target === "claude-repository");
		mapping.probe.kind = "codex-plugin-consumer";

		assert.throws(
			() => assertProbeFixtureBindings(capabilities, PROBE_FIXTURES),
			/skill:pfd-ops: claude-repository mapping references codex-plugin-consumer fixture for codex-plugin/,
		);
	});

	it("rejects an orphan probe fixture kind", () => {
		const fixtures = {
			...PROBE_FIXTURES,
			orphan: { target: "claude-repository", probe: () => {} },
		};

		assert.throws(
			() => assertProbeFixtureBindings(HARNESS_CAPABILITY_CONTRACT, fixtures),
			/orphan probe fixture kind orphan/,
		);
	});

	it("keeps Codex plugin agent exclusions explicit and output-free", () => {
		for (const id of ["agent:pfd-lens", "agent:pfd-implementer"]) {
			const capability = HARNESS_CAPABILITY_CONTRACT.find(
				(record) => record.id === id,
			);
			const mapping = capability.mappings.find(
				({ target }) => target === "codex-plugin",
			);
			assert.equal(mapping.disposition, "intentional-exclusion", id);
			assert.match(mapping.reason, /\S/, id);
			assert.match(mapping.impact, /\S/, id);
			assert.equal(Object.hasOwn(mapping, "outputs"), false, id);

			assert.throws(
				() =>
					validateCapabilityContract(
						[
							{
								...capability,
								mappings: capability.mappings.filter(
									({ target }) => target !== "codex-plugin",
								),
							},
						],
						{ probeKinds: PROBE_FIXTURES },
					),
				/missing mapping for codex-plugin/,
			);
		}
	});

	it("rejects every missing delivery target mapping symmetrically", () => {
		for (const target of DELIVERY_TARGETS) {
			const capability = withoutMapping(completeCapability(), target);
			assert.throws(
				() => validateCapabilityContract([capability], { probeKinds }),
				new RegExp(`capability:test: missing mapping for ${target}`),
			);
		}
	});

	it("normalizes declarations and selects one target mapping", () => {
		const [validated] = validateCapabilityContract([completeCapability()], {
			probeKinds,
		});

		assert.deepEqual(Object.keys(validated.mappings), DELIVERY_TARGETS);
		assert.deepEqual(capabilitiesForTarget([validated], "codex-plugin"), [
			{ ...validated, mapping: mappingFor(validated, "codex-plugin") },
		]);
	});

	it("rejects an unknown target with the capability ID", () => {
		const capability = {
			...completeCapability(),
			mappings: [
				...completeCapability().mappings,
				{
					target: "unknown",
					disposition: "native",
					outputs: ["x"],
					probe: { kind: "test-probe" },
				},
			],
		};

		assert.throws(
			() => validateCapabilityContract([capability], { probeKinds }),
			/capability:test: unknown mapping target unknown/,
		);
	});

	it("rejects an unknown disposition with the capability ID", () => {
		const capability = withMapping(completeCapability(), "claude-repository", {
			disposition: "default",
		});

		assert.throws(
			() => validateCapabilityContract([capability], { probeKinds }),
			/capability:test: unknown disposition default for claude-repository/,
		);
	});

	it("rejects duplicate declarations for one target", () => {
		const complete = completeCapability();
		const capability = {
			...complete,
			mappings: [
				...complete.mappings,
				{
					...mappingFor(complete, "claude-repository"),
					disposition: "transform",
				},
			],
		};

		assert.throws(
			() => validateCapabilityContract([capability], { probeKinds }),
			/capability:test: duplicate mapping for claude-repository/,
		);
	});

	for (const disposition of ["native", "transform"]) {
		it(`rejects empty outputs for ${disposition}`, () => {
			const capability = withMapping(
				completeCapability(),
				"claude-repository",
				{
					disposition,
					outputs: [],
				},
			);

			assert.throws(
				() => validateCapabilityContract([capability], { probeKinds }),
				new RegExp(
					`capability:test: claude-repository ${disposition} mapping requires non-empty outputs`,
				),
			);
		});

		it(`rejects empty probes for ${disposition}`, () => {
			const capability = withMapping(
				completeCapability(),
				"claude-repository",
				{
					disposition,
					probe: { kind: "" },
				},
			);

			assert.throws(
				() => validateCapabilityContract([capability], { probeKinds }),
				new RegExp(
					`capability:test: claude-repository ${disposition} mapping requires probe`,
				),
			);
		});
	}

	it("rejects an unregistered probe kind", () => {
		const capability = withMapping(completeCapability(), "claude-repository", {
			probe: { kind: "missing-probe" },
		});

		assert.throws(
			() => validateCapabilityContract([capability], { probeKinds }),
			/capability:test: unknown probe kind missing-probe for claude-repository/,
		);
	});

	it("requires reason and impact for intentional exclusions", () => {
		for (const field of ["reason", "impact"]) {
			const capability = withMapping(completeCapability(), "codex-plugin", {
				disposition: "intentional-exclusion",
				reason: "excluded for test",
				impact: "test impact",
				[field]: "",
			});
			assert.throws(
				() => validateCapabilityContract([capability], { probeKinds }),
				new RegExp(
					`capability:test: codex-plugin intentional-exclusion mapping requires non-empty ${field}`,
				),
			);
		}
	});

	for (const target of DELIVERY_TARGETS) {
		it(`reports extra output surfaces for ${target}`, () => {
			assert.throws(
				() =>
					assertTargetOutputClosure({
						target,
						declared: [
							{ surface: "surface:test", capabilityId: "capability:test" },
						],
						observed: [
							{ surface: "surface:test", capabilityId: "capability:test" },
							{ surface: "surface:extra", capabilityId: "capability:extra" },
						],
					}),
				new RegExp(
					`output closure ${target}: undeclared surface surface:extra from capability:extra`,
				),
			);
		});

		it(`reports missing output surfaces for ${target}`, () => {
			assert.throws(
				() =>
					assertTargetOutputClosure({
						target,
						declared: [
							{ surface: "surface:missing", capabilityId: "capability:test" },
						],
						observed: [],
					}),
				new RegExp(
					`output closure ${target}: missing surface surface:missing declared by capability:test`,
				),
			);
		});
	}
});
