import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { RELEASE_KINDS } from "./release-config.mjs";
import {
	formatCliCandidateNotice,
	formatExistingVsixNotice,
	prepareRelease,
	publishRelease,
} from "./release-runner.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";

it("rejects Git target environment overrides before either release phase runs", () => {
	const previous = process.env.GIT_DIR;
	process.env.GIT_DIR = "/not-the-release-worktree/.git";
	try {
		for (const phase of [prepareRelease, publishRelease]) {
			assert.throws(
				() =>
					phase({
						root: "/not-read",
						kindArg: "cli",
						version: "0.0.2",
						commit: SHA,
						capture: () => {
							throw new Error("Git was executed");
						},
						run: () => {
							throw new Error("a command was executed");
						},
					}),
				/Git target environment overrides/,
			);
		}
	} finally {
		if (previous === undefined) delete process.env.GIT_DIR;
		else process.env.GIT_DIR = previous;
	}
});

function packageRoot(kind, version = "0.0.1") {
	const root = mkdtempSync(join(tmpdir(), "pfdsl-release-runner-"));
	for (const path of RELEASE_KINDS[kind].packages) {
		const absolute = join(root, path);
		mkdirSync(join(absolute, ".."), { recursive: true });
		writeFileSync(
			absolute,
			`${JSON.stringify({ name: kind === "vscode" ? "pfdsl" : path, version }, null, "\t")}\n`,
		);
	}
	return root;
}

function missingProbe() {
	const error = new Error("missing");
	error.status = 1;
	throw error;
}

function cleanCapture({
	head = SHA,
	origin = SHA,
	dirty = "",
	tagOutput = "",
} = {}) {
	return (cmd, args) => {
		if (cmd !== "git") throw new Error(`unexpected capture ${cmd}`);
		if (args[0] === "rev-parse" && args[1] === "--abbrev-ref")
			return "release/0.0.1";
		if (args[0] === "rev-parse" && args[1] === "HEAD") return head;
		if (args[0] === "rev-parse" && args[1] === "origin/main") return origin;
		if (args[0] === "status") return dirty;
		if (
			args[0] === "show-ref" ||
			(args[0] === "rev-parse" && args.some((arg) => arg.startsWith("refs/")))
		)
			return missingProbe();
		if (args[0] === "ls-remote") return tagOutput;
		throw new Error(`unexpected git capture: ${args.join(" ")}`);
	};
}

function cliTrace({
	localTag = null,
	remoteTag = "",
	origin = SHA,
	finalOrigin = origin,
	gateResults = [],
	candidateError = false,
	candidateOutput = JSON.stringify({
		ready: [{ id: "publish_cli_a", outputs: ["cli_release_a"] }],
	}),
} = {}) {
	const calls = [];
	let localTagState = localTag;
	let remoteTagState = remoteTag;
	let fetches = 0;
	const capture = (cmd, args) => {
		if (cmd !== "git" && cmd !== "gh" && cmd !== "node")
			throw new Error(`unexpected capture ${cmd}`);
		if (cmd === "git" && args[0] === "status") return "";
		if (cmd === "git" && args[0] === "rev-parse" && args[1] === "HEAD")
			return SHA;
		if (cmd === "git" && args[0] === "rev-parse" && args[1] === "origin/main")
			return fetches > 1 ? finalOrigin : origin;
		if (cmd === "git" && args[0] === "show-ref")
			return localTagState === null ? missingProbe() : "";
		if (
			cmd === "git" &&
			args[0] === "rev-parse" &&
			args.some((arg) => arg.includes("refs/tags/"))
		)
			return localTagState;
		if (cmd === "git" && args[0] === "ls-remote") return remoteTagState;
		if (cmd === "git" && args[0] === "remote")
			return "https://github.com/takasek/pfdsl.git";
		if (cmd === "gh" && args[0] === "run")
			return JSON.stringify([
				{ databaseId: 42, headBranch: "v0.0.1", headSha: SHA },
			]);
		if (cmd === "node") {
			if (candidateError) {
				const error = new Error("dist unavailable");
				error.status = 1;
				throw error;
			}
			return candidateOutput;
		}
		throw new Error(`unexpected capture: ${cmd} ${args.join(" ")}`);
	};
	const run = (cmd, args) => {
		calls.push([cmd, args]);
		if (cmd === "git" && args[0] === "fetch") fetches += 1;
		if (cmd === "git" && args[0] === "tag") localTagState = SHA;
		if (cmd === "git" && args[0] === "push")
			remoteTagState = `${SHA}\trefs/tags/v0.0.1\n`;
	};
	return {
		calls,
		capture,
		run,
		runReleaseGates: () => gateResults,
		sleep: () => {},
	};
}

describe("prepareRelease", () => {
	it("rejects main before changing files", () => {
		const root = packageRoot("cli");
		const calls = [];
		try {
			assert.throws(
				() =>
					prepareRelease({
						root,
						kindArg: "cli",
						version: "0.0.2",
						capture: (cmd, args) => {
							calls.push([cmd, args]);
							return "main";
						},
					}),
				/work branch/,
			);
			assert.equal(calls.length, 1);
			assert.equal(calls[0][0], "git");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("bumps the requested packages and runs CLI generation without git mutation", () => {
		const root = packageRoot("cli");
		const calls = [];
		try {
			prepareRelease({
				root,
				kindArg: "cli",
				version: "0.0.2",
				capture: (cmd, args) => {
					calls.push(["capture", cmd, args]);
					if (args[0] === "rev-parse") return "release/libs";
					if (args[0] === "status") return "";
					throw new Error(`unexpected ${args.join(" ")}`);
				},
				run: (cmd, args) => calls.push(["run", cmd, args]),
			});
			for (const path of RELEASE_KINDS.cli.packages) {
				assert.equal(
					JSON.parse(readFileSync(join(root, path), "utf8")).version,
					"0.0.2",
				);
			}
			assert.deepEqual(
				calls.filter((call) => call[0] === "run").map((call) => call.slice(1)),
				[["make", ["gen-plugin"]]],
			);
			assert.equal(
				calls.some((call) => call[2]?.includes("commit")),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("publishRelease", () => {
	it("refuses to tag when HEAD changes during checks", () => {
		const root = packageRoot("vscode");
		const calls = [];
		let headReads = 0;
		try {
			assert.throws(
				() =>
					publishRelease({
						root,
						kindArg: "vscode",
						commit: SHA,
						capture: (cmd, args) => {
							if (args[0] === "rev-parse" && args[1] === "HEAD")
								return headReads++ === 0 ? SHA : OTHER_SHA;
							return cleanCapture()(cmd, args);
						},
						run: (cmd, args) => calls.push([cmd, args]),
						runReleaseGates: () => [],
					}),
				/HEAD changed/,
			);
			assert.equal(
				calls.some(([cmd, args]) => cmd === "git" && args[0] === "tag"),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("creates and pushes an explicit tag when a same-name branch exists", () => {
		const root = packageRoot("vscode");
		const calls = [];
		let created = false;
		let pushed = false;
		try {
			publishRelease({
				root,
				kindArg: "vscode",
				commit: SHA,
				capture: (cmd, args) => {
					if (args[0] === "ls-remote") {
						return pushed ? `${SHA}\trefs/tags/vscode-v0.0.1\n` : "";
					}
					if (
						args[0] === "show-ref" &&
						args.some((arg) => arg.includes("refs/heads/"))
					)
						return "";
					if (
						args[0] === "show-ref" &&
						args.some((arg) => arg.includes("refs/tags/"))
					) {
						if (!created) return missingProbe();
						return "";
					}
					if (
						args[0] === "rev-parse" &&
						args.some((arg) => arg.includes("refs/tags/"))
					) {
						if (!created) return missingProbe();
						return SHA;
					}
					return cleanCapture()(cmd, args);
				},
				run: (cmd, args) => {
					calls.push([cmd, args]);
					if (cmd === "git" && args[0] === "tag") created = true;
					if (cmd === "git" && args[0] === "push") pushed = true;
					if (cmd === "vsce")
						writeFileSync(
							join(root, "packages/vscode-extension", "pfdsl-0.0.1.vsix"),
							"vsix",
						);
				},
				runReleaseGates: () => [],
			});
			assert.ok(
				calls.some(
					([cmd, args]) =>
						cmd === "git" && args.join(" ") === `tag vscode-v0.0.1 ${SHA}`,
				),
			);
			assert.ok(
				calls.some(
					([cmd, args]) =>
						cmd === "git" &&
						args.join(" ").includes(`${SHA}:refs/tags/vscode-v0.0.1`),
				),
			);
			assert.equal(
				calls.some(
					([cmd, args]) =>
						cmd === "git" && args[0] === "push" && args.includes("main"),
				),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not tag or push when VSIX packaging omits the expected candidate", () => {
		const root = packageRoot("vscode");
		const calls = [];
		try {
			assert.throws(
				() =>
					publishRelease({
						root,
						kindArg: "vscode",
						commit: SHA,
						capture: cleanCapture(),
						run: (cmd, args) => calls.push([cmd, args]),
						runReleaseGates: () => [],
					}),
				/expected VSIX candidate/,
			);
			assert.equal(
				calls.some(
					([cmd, args]) => cmd === "git" && ["tag", "push"].includes(args[0]),
				),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resumes an already published remote tag without rerunning checks", () => {
		const root = packageRoot("vscode");
		const calls = [];
		try {
			assert.throws(
				() =>
					publishRelease({
						root,
						kindArg: "vscode",
						commit: SHA,
						capture: cleanCapture({
							origin: OTHER_SHA,
							tagOutput: `${SHA}\trefs/tags/vscode-v0.0.1\n`,
						}),
						run: (cmd, args) => calls.push([cmd, args]),
						runReleaseGates: () => {
							throw new Error("checks must be skipped");
						},
					}),
				/VSIX candidate/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resumes a published remote VS Code tag when its candidate is present", () => {
		const root = packageRoot("vscode");
		const calls = [];
		writeFileSync(
			join(root, "packages/vscode-extension", "pfdsl-0.0.1.vsix"),
			"vsix",
		);
		try {
			publishRelease({
				root,
				kindArg: "vscode",
				commit: SHA,
				capture: cleanCapture({
					origin: OTHER_SHA,
					tagOutput: `${SHA}\trefs/tags/vscode-v0.0.1\n`,
				}),
				run: (cmd, args) => calls.push([cmd, args]),
				runReleaseGates: () => {
					throw new Error("checks must be skipped");
				},
			});
			assert.equal(
				calls.some(([cmd]) => cmd === "make"),
				false,
			);
			assert.equal(
				calls.some(([cmd, args]) => cmd === "git" && args[0] === "tag"),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects an old-version VSIX candidate during remote resume", () => {
		const root = packageRoot("vscode");
		writeFileSync(
			join(root, "packages/vscode-extension", "pfdsl-0.0.0.vsix"),
			"vsix",
		);
		try {
			assert.throws(
				() =>
					publishRelease({
						root,
						kindArg: "vscode",
						commit: SHA,
						capture: cleanCapture({
							origin: OTHER_SHA,
							tagOutput: `${SHA}\trefs/tags/vscode-v0.0.1\n`,
						}),
						runReleaseGates: () => [],
					}),
				/VSIX candidate/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("names the commit provenance check when resuming an existing VSIX", () => {
		assert.match(
			formatExistingVsixNotice("pfdsl-0.0.18.vsix", SHA),
			/verify it was packaged from .* before installation\/upload/,
		);
	});

	it("does not treat a Git probe execution failure as a missing tag", () => {
		const root = packageRoot("vscode");
		try {
			assert.throws(
				() =>
					publishRelease({
						root,
						kindArg: "vscode",
						commit: SHA,
						capture: (cmd, args) => {
							if (args[0] === "show-ref") {
								const error = new Error("git repository unavailable");
								error.status = 128;
								throw error;
							}
							return cleanCapture()(cmd, args);
						},
						runReleaseGates: () => [],
					}),
				/git repository unavailable/,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("includes marketplace retrieval and roadmap PR handoff in the CLI candidate notice", () => {
		const notice = formatCliCandidateNotice(["cli_release_a"]);
		assert.match(notice, /marketplace/);
		assert.match(notice, /main/);
		assert.match(notice, /roadmap PR/);
	});

	it("watches the exact CLI workflow run and only displays ready candidates", () => {
		const root = packageRoot("cli");
		const trace = cliTrace();
		try {
			publishRelease({ root, kindArg: "cli", commit: SHA, ...trace });
			assert.ok(
				trace.calls.some(
					([cmd, args]) =>
						cmd === "gh" && args.join(" ") === "run watch 42 --exit-status",
				),
			);
			assert.equal(
				trace.calls.some(([cmd, args]) => cmd === "git" && args[0] === "meta"),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resumes a published CLI tag without checks or tag mutation after main advances", () => {
		const root = packageRoot("cli");
		const trace = cliTrace({
			remoteTag: `${SHA}\trefs/tags/v0.0.1\n`,
			origin: OTHER_SHA,
		});
		try {
			publishRelease({ root, kindArg: "cli", commit: SHA, ...trace });
			assert.equal(
				trace.calls.some(([cmd]) => cmd === "make"),
				false,
			);
			assert.equal(
				trace.calls.some(
					([cmd, args]) => cmd === "git" && ["tag", "push"].includes(args[0]),
				),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps a published CLI resume successful when the local dist is unavailable", () => {
		const root = packageRoot("cli");
		const trace = cliTrace({
			remoteTag: `${SHA}\trefs/tags/v0.0.1\n`,
			origin: OTHER_SHA,
			candidateError: true,
		});
		try {
			publishRelease({ root, kindArg: "cli", commit: SHA, ...trace });
			assert.equal(
				trace.calls.some(
					([cmd, args]) => cmd === "git" && ["tag", "push"].includes(args[0]),
				),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps a published CLI resume successful when status output is invalid", () => {
		const root = packageRoot("cli");
		const trace = cliTrace({
			remoteTag: `${SHA}\trefs/tags/v0.0.1\n`,
			origin: OTHER_SHA,
			candidateOutput: "{}",
		});
		try {
			publishRelease({ root, kindArg: "cli", commit: SHA, ...trace });
			assert.equal(
				trace.calls.some(
					([cmd, args]) => cmd === "git" && ["tag", "push"].includes(args[0]),
				),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not tag or push when a release gate fails", () => {
		const root = packageRoot("cli");
		const trace = cliTrace({
			gateResults: [{ id: "gate", ok: false, lines: ["failed"] }],
		});
		try {
			assert.throws(
				() => publishRelease({ root, kindArg: "cli", commit: SHA, ...trace }),
				/release gate failed/,
			);
			assert.equal(
				trace.calls.some(
					([cmd, args]) => cmd === "git" && ["tag", "push"].includes(args[0]),
				),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not tag or push when the final origin/main ref advances", () => {
		const root = packageRoot("cli");
		const trace = cliTrace({ finalOrigin: OTHER_SHA });
		try {
			assert.throws(
				() => publishRelease({ root, kindArg: "cli", commit: SHA, ...trace }),
				/origin\/main/,
			);
			assert.equal(
				trace.calls.some(
					([cmd, args]) => cmd === "git" && ["tag", "push"].includes(args[0]),
				),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects an existing local tag that points to another commit", () => {
		const root = packageRoot("cli");
		const trace = cliTrace({ localTag: OTHER_SHA });
		try {
			assert.throws(
				() => publishRelease({ root, kindArg: "cli", commit: SHA, ...trace }),
				/local tag/,
			);
			assert.equal(
				trace.calls.some(([cmd]) => cmd === "git"),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("rejects a remote tag that points to another commit", () => {
		const root = packageRoot("cli");
		const trace = cliTrace({ remoteTag: `${OTHER_SHA}\trefs/tags/v0.0.1\n` });
		try {
			assert.throws(
				() => publishRelease({ root, kindArg: "cli", commit: SHA, ...trace }),
				/remote tag/,
			);
			assert.equal(
				trace.calls.some(([cmd]) => cmd === "git"),
				false,
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
