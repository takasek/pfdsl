import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	assertTargetOutputClosure,
	capabilitiesForTarget,
	DELIVERY_TARGETS,
	validateCapabilityContract,
} from "./harness-capability-contract.mjs";

const probeKinds = new Set(["test-probe"]);

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
