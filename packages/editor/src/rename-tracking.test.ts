import { expect, it } from "vitest";
import { RenameTracking } from "./rename-tracking.js";

const request = {
	type: "renameNode" as const,
	requestId: "rename-1",
	nodeId: "p",
	newId: "build",
	label: "",
	source: "a >> p -> b\n",
};
const saved = "a >> build -> b\n";

it("keeps a rename when Undo removes only later comments", () => {
	const tracking = new RenameTracking();
	tracking.begin(request, saved);
	tracking.observe(request.source, true);
	tracking.observe(saved);
	tracking.observe(`${saved}# first\n# second\n`);
	tracking.observe(`${saved}# first\n`, true);
	expect(tracking.invalidatedRequestId).toBeUndefined();
});

it.each([
	request.source,
	"build >> x -> y\n",
])("invalidates a rename when Undo removes its node or changes its kind: %s", (undone) => {
	const tracking = new RenameTracking();
	tracking.begin(request, saved);
	tracking.observe(saved);
	tracking.observe(undone, true);
	tracking.observe(saved);
	expect(tracking.invalidatedRequestId).toBe(request.requestId);
	tracking.begin({ ...request, requestId: "rename-2" }, saved);
	expect(tracking.invalidatedRequestId).toBeUndefined();
});

it("does not track a Label-only edit as an ID move", () => {
	const tracking = new RenameTracking();
	tracking.begin({ ...request, newId: "p", label: "Build" }, saved);
	tracking.observe(saved);
	tracking.observe(request.source, true);
	expect(tracking.invalidatedRequestId).toBeUndefined();
});
