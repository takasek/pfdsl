import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveCompanions } from "./sample-companions.mjs";

describe("resolveCompanions", () => {
	it("assigns files prefixed with a registered id (plus '-') as its companions", () => {
		const { companionsById, orphans } = resolveCompanions(
			["12-subflow", "13-preset"],
			["12-subflow", "12-subflow-detail", "13-preset", "13-preset-base"],
		);
		assert.deepEqual(companionsById.get("12-subflow"), ["12-subflow-detail"]);
		assert.deepEqual(companionsById.get("13-preset"), ["13-preset-base"]);
		assert.deepEqual(orphans, []);
	});

	it("reports files matching no registered id as orphans", () => {
		const { companionsById, orphans } = resolveCompanions(
			["01-simple-chain"],
			["01-simple-chain", "99-unregistered"],
		);
		assert.equal(companionsById.size, 0);
		assert.deepEqual(orphans, ["99-unregistered"]);
	});

	it("does not treat a registered id as a companion of a shorter registered prefix", () => {
		const { companionsById, orphans } = resolveCompanions(
			["12-subflow", "12-subflow-detail"],
			["12-subflow", "12-subflow-detail"],
		);
		assert.equal(companionsById.size, 0);
		assert.deepEqual(orphans, []);
	});

	it("assigns a companion to the longest matching registered id", () => {
		const { companionsById } = resolveCompanions(
			["12-subflow", "12-subflow-detail"],
			["12-subflow", "12-subflow-detail", "12-subflow-detail-extra"],
		);
		assert.deepEqual(companionsById.get("12-subflow-detail"), ["12-subflow-detail-extra"]);
		assert.equal(companionsById.has("12-subflow"), false);
	});

	it("sorts multiple companions of one id", () => {
		const { companionsById } = resolveCompanions(
			["14-boundary"],
			["14-boundary", "14-boundary-detail", "14-boundary-alt"],
		);
		assert.deepEqual(companionsById.get("14-boundary"), ["14-boundary-alt", "14-boundary-detail"]);
	});
});
