import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveSkillRoot } from "./skill-sync.js";

describe("resolveSkillRoot", () => {
	it("resolves to a directory containing SKILL.md", () => {
		const root = resolveSkillRoot();
		expect(existsSync(`${root}/SKILL.md`)).toBe(true);
	});
});
