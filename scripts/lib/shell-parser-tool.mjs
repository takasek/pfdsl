import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const SHFMT_VERSION = "v3.14.1";
// Official mvdan/sh release assets, pinned independently of PATH.
const ASSETS = {
	"darwin-x64": [
		"darwin_amd64",
		"d33eee0da0f92835b3562e9767a05cee7e4eaeef47daa03bfd09da17b4b590a6",
	],
	"darwin-arm64": [
		"darwin_arm64",
		"b7c872db63553ccffc7253aba3ed7d4885a27d83f1ba567b1138c6315a5847e5",
	],
	"linux-x64": [
		"linux_amd64",
		"76e77641faa025814b77f153b29796b8e6fa2fca03e0c76a691608b86c7ea7bf",
	],
	"linux-arm64": [
		"linux_arm64",
		"5f2db09dae91fca848f7adbdd014632e921a383863a2ad7e0450ad3aba0c6489",
	],
	"win32-x64": [
		"windows_amd64.exe",
		"13629ce28442ca80b6b5a819f7574ab39e1c28c6e26734ca816c9714e04851df",
	],
};

export function shellParserPath(root, platform = process.platform) {
	return join(
		root,
		"node_modules",
		".pfdsl-tools",
		`shfmt-${SHFMT_VERSION}${platform === "win32" ? ".exe" : ""}`,
	);
}

export function isShellParserInstalled(root) {
	const asset = ASSETS[`${process.platform}-${process.arch}`];
	if (!asset) return false;
	try {
		if (
			process.platform !== "win32" &&
			(statSync(shellParserPath(root)).mode & 0o111) === 0
		)
			return false;
		return (
			createHash("sha256")
				.update(readFileSync(shellParserPath(root)))
				.digest("hex") === asset[1]
		);
	} catch {
		return false;
	}
}

export async function installShellParser(root, { fetchAsset = fetch } = {}) {
	if (isShellParserInstalled(root)) return;
	const asset = ASSETS[`${process.platform}-${process.arch}`];
	if (!asset)
		throw new Error(
			`No pinned shfmt release for ${process.platform}/${process.arch}.`,
		);
	const response = await fetchAsset(
		`https://github.com/mvdan/sh/releases/download/${SHFMT_VERSION}/shfmt_${SHFMT_VERSION}_${asset[0]}`,
		{ signal: AbortSignal.timeout(60_000) },
	);
	if (!response.ok)
		throw new Error(`Cannot install shfmt: HTTP ${response.status}.`);
	const bytes = Buffer.from(await response.arrayBuffer());
	if (createHash("sha256").update(bytes).digest("hex") !== asset[1])
		throw new Error(
			"The shfmt release checksum does not match the pinned asset.",
		);
	const destination = shellParserPath(root);
	mkdirSync(dirname(destination), { recursive: true });
	const temporary = `${destination}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, bytes, { flag: "wx" });
		chmodSync(temporary, 0o755);
		renameSync(temporary, destination);
	} finally {
		rmSync(temporary, { force: true });
	}
}
