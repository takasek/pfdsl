export const DELIVERY_TARGETS = Object.freeze([
	"claude-repository",
	"claude-plugin",
	"codex-repository",
	"codex-plugin",
]);

const DISPOSITIONS = new Set(["native", "transform", "intentional-exclusion"]);

function capabilityId(capability) {
	return String(capability?.id ?? "<unknown-capability>");
}

function fail(message, details = {}) {
	const error = new Error(message);
	Object.assign(error, details);
	throw error;
}

function mappingDeclarations(mappings) {
	if (Array.isArray(mappings)) return mappings;
	if (mappings && typeof mappings === "object") {
		return Object.entries(mappings).map(([target, mapping]) => ({
			...mapping,
			target,
		}));
	}
	return [];
}

function nonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function probeKind(probe) {
	if (typeof probe === "string") return probe;
	return probe?.kind;
}

function registeredProbeKinds(probeKinds) {
	if (probeKinds instanceof Set) return probeKinds;
	if (Array.isArray(probeKinds)) return new Set(probeKinds);
	if (probeKinds && typeof probeKinds === "object") {
		return new Set(Object.keys(probeKinds));
	}
	return new Set();
}

function validateMapping(capability, mapping, probeKinds) {
	const id = capabilityId(capability);
	const target = mapping?.target;
	const disposition = mapping?.disposition;
	if (!DISPOSITIONS.has(disposition)) {
		fail(`${id}: unknown disposition ${String(disposition)} for ${target}`, {
			capabilityId: id,
			target,
			disposition,
		});
	}

	if (disposition === "intentional-exclusion") {
		if (!nonEmptyString(mapping.reason)) {
			fail(
				`${id}: ${target} intentional-exclusion mapping requires non-empty reason`,
				{
					capabilityId: id,
					target,
				},
			);
		}
		if (!nonEmptyString(mapping.impact)) {
			fail(
				`${id}: ${target} intentional-exclusion mapping requires non-empty impact`,
				{
					capabilityId: id,
					target,
				},
			);
		}
		return { ...mapping, target, disposition };
	}

	if (!Array.isArray(mapping.outputs) || mapping.outputs.length === 0) {
		fail(`${id}: ${target} ${disposition} mapping requires non-empty outputs`, {
			capabilityId: id,
			target,
		});
	}
	if (!mapping.outputs.every((surface) => nonEmptyString(surface))) {
		fail(
			`${id}: ${target} ${disposition} mapping outputs must be non-empty strings`,
			{
				capabilityId: id,
				target,
			},
		);
	}
	const kind = probeKind(mapping.probe);
	if (!nonEmptyString(kind)) {
		fail(`${id}: ${target} ${disposition} mapping requires probe`, {
			capabilityId: id,
			target,
		});
	}
	if (!probeKinds.has(kind)) {
		fail(`${id}: unknown probe kind ${kind} for ${target}`, {
			capabilityId: id,
			target,
			probeKind: kind,
		});
	}
	return { ...mapping, target, disposition };
}

function validateCapability(capability, probeKinds) {
	const id = capabilityId(capability);
	const declarations = mappingDeclarations(capability?.mappings);
	const normalized = {};
	const seen = new Map();

	for (const declaration of declarations) {
		const target = declaration?.target;
		if (!DELIVERY_TARGETS.includes(target)) {
			fail(`${id}: unknown mapping target ${String(target)}`, {
				capabilityId: id,
				target,
			});
		}
		if (seen.has(target)) {
			fail(
				`${id}: duplicate mapping for ${target}; dispositions: ${seen.get(target)}, ${declaration.disposition}`,
				{ capabilityId: id, target },
			);
		}
		const mapping = validateMapping(capability, declaration, probeKinds);
		seen.set(target, mapping.disposition);
		normalized[target] = mapping;
	}

	for (const target of DELIVERY_TARGETS) {
		if (!seen.has(target)) {
			fail(`${id}: missing mapping for ${target}`, {
				capabilityId: id,
				target,
			});
		}
	}

	return { ...capability, mappings: normalized };
}

export function validateCapabilityContract(capabilities, { probeKinds } = {}) {
	if (!Array.isArray(capabilities)) {
		throw new TypeError("capabilities must be an array");
	}
	const registered = registeredProbeKinds(probeKinds);
	return capabilities.map((capability) =>
		validateCapability(capability, registered),
	);
}

export function capabilitiesForTarget(capabilities, target) {
	if (!DELIVERY_TARGETS.includes(target)) {
		throw new Error(`unknown delivery target ${String(target)}`);
	}
	return capabilities.map((capability) => ({
		...capability,
		mapping: capability.mappings[target],
	}));
}

function surfaceEntries(entries, fallbackCapabilityId) {
	if (entries instanceof Set) entries = [...entries];
	if (!Array.isArray(entries)) return [];
	return entries.map((entry) => {
		if (typeof entry === "string") {
			return { surface: entry, capabilityId: fallbackCapabilityId };
		}
		return {
			surface: entry?.surface,
			capabilityId:
				entry?.capabilityId ??
				entry?.capability ??
				entry?.id ??
				fallbackCapabilityId,
		};
	});
}

export function assertTargetOutputClosure({ target, declared, observed }) {
	if (!DELIVERY_TARGETS.includes(target)) {
		throw new Error(`unknown delivery target ${String(target)}`);
	}
	const declaredEntries = surfaceEntries(declared).sort((left, right) =>
		String(left.surface).localeCompare(String(right.surface)),
	);
	const observedEntries = surfaceEntries(observed).sort((left, right) =>
		String(left.surface).localeCompare(String(right.surface)),
	);
	const declaredBySurface = new Map(
		declaredEntries.map((entry) => [entry.surface, entry]),
	);
	const observedBySurface = new Map(
		observedEntries.map((entry) => [entry.surface, entry]),
	);

	for (const entry of observedEntries) {
		if (!declaredBySurface.has(entry.surface)) {
			fail(
				`output closure ${target}: undeclared surface ${entry.surface} from ${entry.capabilityId}`,
				{
					target,
					surface: entry.surface,
					capabilityId: entry.capabilityId,
					closure: "extra",
				},
			);
		}
	}
	for (const entry of declaredEntries) {
		if (!observedBySurface.has(entry.surface)) {
			fail(
				`output closure ${target}: missing surface ${entry.surface} declared by ${entry.capabilityId}`,
				{
					target,
					surface: entry.surface,
					capabilityId: entry.capabilityId,
					closure: "missing",
				},
			);
		}
	}
	return true;
}
