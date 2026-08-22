import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	buildAuditArgs,
	classifyRoadmapRegistration,
} from "./roadmap-registration.mjs";

describe("buildAuditArgs", () => {
	it("enforces every issue the PR closes", () => {
		assert.deepEqual(buildAuditArgs([12, 34]), [
			"scripts/pfdsl/audit-issues-flow.mjs",
			"--enforce-issue",
			"12",
			"--enforce-issue",
			"34",
		]);
	});

	it("enforces nothing when the PR closes nothing", () => {
		assert.deepEqual(buildAuditArgs([]), [
			"scripts/pfdsl/audit-issues-flow.mjs",
		]);
	});
});

describe("classifyRoadmapRegistration", () => {
	it("skips when the PR closes no issue: there is nothing this PR can register", () => {
		const r = classifyRoadmapRegistration({ issueNumbers: [], auditExit: 0 });
		assert.equal(r.status, "SKIP");
	});

	it("passes when the audit accepts the tree", () => {
		const r = classifyRoadmapRegistration({ issueNumbers: [12], auditExit: 0 });
		assert.equal(r.status, "PASS");
		// A flow:exempt issue passes by being absent by design, so the wording
		// must not claim the issue was registered.
		assert.doesNotMatch(r.detail, /registered/);
	});

	it("fails when the audit rejects it", () => {
		const r = classifyRoadmapRegistration({ issueNumbers: [12], auditExit: 1 });
		assert.equal(r.status, "FAIL");
		assert.match(r.detail, /12/);
	});

	it("skips on the gh-unavailable exit code rather than reading it as a rejection", () => {
		const r = classifyRoadmapRegistration({ issueNumbers: [12], auditExit: 2 });
		assert.equal(r.status, "SKIP");
		assert.match(r.detail, /gh/);
	});
});
