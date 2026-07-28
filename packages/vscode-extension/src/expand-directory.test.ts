import { describe, expect, it, vi } from "vitest";
import {
	type DirectoryAccess,
	type DirectoryEntry,
	expandDirectory,
} from "./expand-directory.js";

/** A directory access over a plain map of path → entries, joined with "/". */
function fakeAccess(tree: Record<string, DirectoryEntry[]>): DirectoryAccess {
	return {
		read: async (path) => {
			const entries = tree[path];
			if (!entries) throw new Error(`ENOENT: ${path}`);
			return entries;
		},
		join: (path, name) => `${path}/${name}`,
	};
}

const file = (name: string): DirectoryEntry => ({ name, isDirectory: false });
const dir = (name: string): DirectoryEntry => ({ name, isDirectory: true });

describe("expandDirectory", () => {
	it("returns the files directly inside the directory", async () => {
		const access = fakeAccess({ "/docs": [file("a.md"), file("b.md")] });
		expect(await expandDirectory(access, "/docs")).toEqual([
			"/docs/a.md",
			"/docs/b.md",
		]);
	});

	it("ignores subdirectories when the directory has files of its own", async () => {
		const access = fakeAccess({
			"/docs": [file("a.md"), dir("archive")],
			"/docs/archive": [file("old.md")],
		});
		expect(await expandDirectory(access, "/docs")).toEqual(["/docs/a.md"]);
	});

	it("descends one level when a directory holds only directories", async () => {
		const access = fakeAccess({
			"/docs": [dir("v1"), dir("v2")],
			"/docs/v1": [file("a.md")],
			"/docs/v2": [file("b.md")],
		});
		expect(await expandDirectory(access, "/docs")).toEqual([
			"/docs/v1/a.md",
			"/docs/v2/b.md",
		]);
	});

	it("keeps descending while each level is directories only", async () => {
		const access = fakeAccess({
			"/docs": [dir("a")],
			"/docs/a": [dir("b")],
			"/docs/a/b": [file("deep.md")],
		});
		expect(await expandDirectory(access, "/docs")).toEqual([
			"/docs/a/b/deep.md",
		]);
	});

	it("yields nothing for an empty directory", async () => {
		expect(await expandDirectory(fakeAccess({ "/docs": [] }), "/docs")).toEqual(
			[],
		);
	});

	it("yields nothing, rather than throwing, when the directory cannot be read", async () => {
		const access = fakeAccess({});
		expect(await expandDirectory(access, "/missing")).toEqual([]);
	});

	it("yields nothing when a nested directory cannot be read", async () => {
		const access = fakeAccess({ "/docs": [dir("gone")] });
		expect(await expandDirectory(access, "/docs")).toEqual([]);
	});

	it("reads each directory once, so a wide tree costs one listing per node", async () => {
		const access = fakeAccess({
			"/docs": [dir("v1")],
			"/docs/v1": [file("a.md")],
		});
		const read = vi.spyOn(access, "read");
		await expandDirectory(access, "/docs");
		expect(read).toHaveBeenCalledTimes(2);
	});
});
