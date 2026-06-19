#!/usr/bin/env node
// Checks published versions of all packages against local package.json versions.
// Usage: node scripts/release-status.mjs
// Exit 1 if any package is behind or has a fetch error.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, formatResults } from "./lib/release-status-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function readLocalVersion(relativePath) {
	const pkg = JSON.parse(readFileSync(resolve(root, relativePath), "utf-8"));
	return pkg.version;
}

async function fetchNpmVersion(packageName) {
	const encoded = encodeURIComponent(packageName);
	const res = await fetch(`https://registry.npmjs.org/${encoded}/latest`);
	if (!res.ok) throw new Error(`npm registry responded ${res.status}`);
	const data = await res.json();
	return data.version;
}

async function fetchVscodeMarketplaceVersion(publisher, extensionName) {
	const res = await fetch(
		"https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json;api-version=3.0-preview.1",
			},
			body: JSON.stringify({
				filters: [
					{
						criteria: [
							{ filterType: 7, value: `${publisher}.${extensionName}` },
						],
						pageNumber: 1,
						pageSize: 1,
					},
				],
				flags: 514,
			}),
		},
	);
	if (!res.ok) throw new Error(`VSCode Marketplace responded ${res.status}`);
	const data = await res.json();
	const ext = data.results?.[0]?.extensions?.[0];
	if (!ext)
		throw new Error(
			`${publisher}.${extensionName} not found in VSCode Marketplace`,
		);
	return ext.versions[0].version;
}

// Add new packages here to extend coverage.
const PACKAGES = [
	{
		name: "@pfdsl/cli",
		registry: "npm",
		localVersionPath: "packages/cli/package.json",
		fetchPublishedVersion: () => fetchNpmVersion("@pfdsl/cli"),
	},
	{
		name: "takasek.pfdsl",
		registry: "vscode-marketplace",
		localVersionPath: "packages/vscode-extension/package.json",
		fetchPublishedVersion: () =>
			fetchVscodeMarketplaceVersion("takasek", "pfdsl"),
	},
];

const results = await Promise.all(
	PACKAGES.map(async (pkg) => {
		const localVersion = readLocalVersion(pkg.localVersionPath);
		let publishedVersion;
		let status;
		try {
			publishedVersion = await pkg.fetchPublishedVersion();
			status = compareVersions(localVersion, publishedVersion);
		} catch (e) {
			publishedVersion = `error: ${e.message}`;
			status = "error";
		}
		return { name: pkg.name, registry: pkg.registry, localVersion, publishedVersion, status };
	}),
);

console.log("release-status:");
console.log(formatResults(results));

const needsAction = results.some(
	(r) => r.status === "local-ahead" || r.status === "error",
);
if (needsAction) process.exit(1);
