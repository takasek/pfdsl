# VS Code Webview Smoke Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable VS Code/Electron smoke test that opens the PFDSL preview and verifies its real webview rendering and pointer interactions.

**Architecture:** `@vscode/test-electron` supplies the VS Code executable while a small Node.js runner starts it with an isolated profile and CDP port. `playwright-core` attaches to the built-in Chromium, opens the contributed preview action, locates the real `vscode-webview` frame, and drives semantic PFDSL DOM selectors without adding test-only product APIs.

**Tech Stack:** Node.js ESM, `node:test`, `@vscode/test-electron`, `playwright-core`, VS Code Extension Development Host, GitHub Actions with xvfb.

**Spec:** `docs/superpowers/specs/2026-08-29-vscode-webview-smoke-test-design.md`

## Global Constraints

- Do not add test-only commands, message variants, or conditional branches to product code.
- Do not use screenshot golden files or selectors based on VS Code internal CSS class names.
- Use `docs/samples/01-simple-chain.pfdsl` as the smoke fixture.
- Pin the smoke binary to VS Code `1.132.1`, the version on which CDP and webview-frame feasibility were measured.
- Use a unique user-data directory, extensions directory, and debugging port for every run.
- Wait on observable frame, DOM, transform, and editor conditions instead of fixed sleeps.
- Always terminate the launched VS Code process and preserve diagnostic logs on failure.
- Keep the smoke test separate from the ordinary unit-test command and run it after the extension build.

---

## File Structure

- `packages/vscode-extension/smoke/harness.mjs`: pure argument, profile, frame-selection, transform-parsing, and cleanup helpers.
- `packages/vscode-extension/smoke/harness.test.mjs`: fast `node:test` coverage for harness behavior that does not require VS Code.
- `packages/vscode-extension/smoke/run.mjs`: executable orchestration and rendering/interaction assertions against VS Code.
- `packages/vscode-extension/package.json`: smoke dependencies and `test:smoke`/`test:smoke:unit` commands.
- `pnpm-lock.yaml`: exact dependency resolution.
- `.github/workflows/test.yml`: xvfb smoke-test invocation after build and fast tests.
- `packages/vscode-extension/README.md`: local command, prerequisites, scope, and failure diagnostics.

### Task 1: Deterministic VS Code Harness Foundation

**Files:**
- Create: `packages/vscode-extension/smoke/harness.test.mjs`
- Create: `packages/vscode-extension/smoke/harness.mjs`
- Modify: `packages/vscode-extension/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: repository root from `import.meta.url`, `downloadAndUnzipVSCode()` from `@vscode/test-electron`, and a numeric CDP port.
- Produces: `makeLaunchArgs({ repoRoot, profileDir, extensionsDir, port, fixturePath }): string[]`, `findWebviewFrame(page): Promise<Frame>`, `parseTransform(value): { panX: number, panY: number, scale: number }`, and `removeRunDirectory(path): Promise<void>`.

- [ ] **Step 1: Add failing unit tests for launch arguments and transform parsing**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { makeLaunchArgs, parseTransform } from "./harness.mjs";

test("makeLaunchArgs isolates the run and opens the fixture", () => {
	assert.deepEqual(
		makeLaunchArgs({
			repoRoot: "/repo",
			profileDir: "/tmp/profile",
			extensionsDir: "/tmp/extensions",
			port: 9337,
			fixturePath: "/repo/docs/samples/01-simple-chain.pfdsl",
		}),
		[
			"--new-window",
			"--skip-welcome",
			"--disable-workspace-trust",
			"--user-data-dir=/tmp/profile",
			"--extensions-dir=/tmp/extensions",
			"--remote-debugging-port=9337",
			"--extensionDevelopmentPath=/repo/packages/vscode-extension",
			"/repo/docs/samples/01-simple-chain.pfdsl",
		],
	);
});

test("parseTransform reads the webview translate and scale", () => {
	assert.deepEqual(parseTransform("translate(12.5px, -8px) scale(1.1)"), {
		panX: 12.5,
		panY: -8,
		scale: 1.1,
	});
});
```

- [ ] **Step 2: Run the tests and verify the Red state**

Run: `node --test packages/vscode-extension/smoke/harness.test.mjs`

Expected: FAIL because `harness.mjs` and its exports do not exist.

- [ ] **Step 3: Add the minimal helpers**

```js
export function makeLaunchArgs({
	repoRoot,
	profileDir,
	extensionsDir,
	port,
	fixturePath,
}) {
	return [
		"--new-window",
		"--skip-welcome",
		"--disable-workspace-trust",
		`--user-data-dir=${profileDir}`,
		`--extensions-dir=${extensionsDir}`,
		`--remote-debugging-port=${port}`,
		`--extensionDevelopmentPath=${repoRoot}/packages/vscode-extension`,
		fixturePath,
	];
}

export function parseTransform(value) {
	const match = /^translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)$/.exec(value);
	if (!match) throw new Error(`Unexpected preview transform: ${value}`);
	return { panX: Number(match[1]), panY: Number(match[2]), scale: Number(match[3]) };
}
```

Add `findWebviewFrame(page)` that waits for a frame whose URL starts with `vscode-webview://` and whose `#root` exists, and add `removeRunDirectory(path)` using `fs.rm(path, { recursive: true, force: true })` only after validating that `path` starts with the run-specific `mkdtemp` parent.

- [ ] **Step 4: Add exact development dependencies and scripts**

Run: `pnpm --filter pfdsl add -D @vscode/test-electron playwright-core`

Add these scripts without changing the existing unit-test command:

```json
"test:smoke": "node smoke/run.mjs",
"test:smoke:unit": "node --test smoke/*.test.mjs"
```

- [ ] **Step 5: Run the fast harness tests and package checks**

Run: `pnpm --filter pfdsl test:smoke:unit`

Expected: PASS with both named tests passing.

Run: `pnpm --filter pfdsl typecheck && pnpm --filter pfdsl build`

Expected: both commands exit 0.

- [ ] **Step 6: Commit the harness foundation**

```bash
git add packages/vscode-extension/package.json packages/vscode-extension/smoke/harness.mjs packages/vscode-extension/smoke/harness.test.mjs pnpm-lock.yaml
git commit -m "test(vscode): add smoke-test harness"
```

### Task 2: Render the Real PFDSL Webview

**Files:**
- Modify: `packages/vscode-extension/smoke/harness.test.mjs`
- Modify: `packages/vscode-extension/smoke/harness.mjs`
- Create: `packages/vscode-extension/smoke/run.mjs`

**Interfaces:**
- Consumes: Task 1 helpers, `downloadAndUnzipVSCode()`, `chromium.connectOverCDP()`, and the editor-title action named `PFDSL: Open Preview to the Side`.
- Produces: `launchSmokeSession(): Promise<{ browser, page, frame, vscodeProcess, runDir }>` and one executable rendering assertion flow.

- [ ] **Step 1: Write a failing webview-frame selection test**

```js
test("findWebviewFrame ignores the outer and fake-empty frames", async () => {
	const frames = [
		{ url: () => "workbench.html", locator: () => ({ count: async () => 0 }) },
		{ url: () => "vscode-webview://one/index.html", locator: () => ({ count: async () => 0 }) },
		{ url: () => "vscode-webview://one/fake.html", locator: () => ({ count: async () => 1 }) },
	];
	assert.equal(await findWebviewFrame({ frames: () => frames }), frames[2]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="findWebviewFrame" packages/vscode-extension/smoke/harness.test.mjs`

Expected: FAIL until `findWebviewFrame` inspects all candidate frames and selects the one containing `#root`.

- [ ] **Step 3: Implement session startup and rendering assertions**

`run.mjs` must perform this sequence inside `try/finally`:

```js
const vscodeExecutablePath = await downloadAndUnzipVSCode("1.132.1");
const vscodeProcess = spawn(vscodeExecutablePath, makeLaunchArgs(options), {
	stdio: ["ignore", "pipe", "pipe"],
});
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const page = browser.contexts()[0].pages()[0];
await page.getByLabel("PFDSL: Open Preview to the Side").click();
const frame = await findWebviewFrame(page);
await assertVisibleCount(frame.locator("#root"), 1, "preview root");
await assertVisibleCount(frame.locator("#inner svg"), 1, "preview SVG");
await assertVisibleCount(frame.locator("g.node"), 6, "sample nodes");
await assertVisibleCount(frame.locator("#minimap"), 1, "minimap");
```

Connection retry must poll the CDP endpoint with an overall timeout and include child-process exit, stdout, and stderr in the thrown diagnostic instead of sleeping a fixed duration.

- [ ] **Step 4: Run the smoke test and verify the Green rendering path**

Run: `pnpm --filter pfdsl test:smoke`

Expected: PASS and print the VS Code version, frame URL, six-node count, and cleanup confirmation.

- [ ] **Step 5: Prove blank-preview detection**

Temporarily change the expected selector from `#inner svg` to `#inner svg.missing`, run `pnpm --filter pfdsl test:smoke`, and verify it FAILs with the frame URL and missing-selector diagnostic.
Restore the selector and rerun to PASS before staging.

- [ ] **Step 6: Commit the rendering smoke test**

```bash
git add packages/vscode-extension/smoke/harness.mjs packages/vscode-extension/smoke/harness.test.mjs packages/vscode-extension/smoke/run.mjs
git commit -m "test(vscode): verify preview rendering in VS Code"
```

### Task 3: Exercise Zoom, Pan, Minimap, and Navigation

**Files:**
- Modify: `packages/vscode-extension/smoke/harness.test.mjs`
- Modify: `packages/vscode-extension/smoke/harness.mjs`
- Modify: `packages/vscode-extension/smoke/run.mjs`

**Interfaces:**
- Consumes: Task 2 `frame`, semantic selectors `#root`, `#inner`, `#minimap`, `#minimap-vp`, and `g.node[data-node-id]`.
- Produces: `readTransform(frame): Promise<ViewTransform>`, `expectEventually(label, read, predicate): Promise<void>`, and interaction assertions with numeric tolerances.

- [ ] **Step 1: Add failing tests for eventual-condition diagnostics**

```js
test("expectEventually reports the last observed value", async () => {
	await assert.rejects(
		expectEventually("scale changes", async () => 1, (value) => value > 1, {
			timeoutMs: 10,
		}),
		/scale changes.*last observed: 1/,
	);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test --test-name-pattern="expectEventually" packages/vscode-extension/smoke/harness.test.mjs`

Expected: FAIL because `expectEventually` is not exported.

- [ ] **Step 3: Implement observable-condition polling**

Implement `expectEventually` with `performance.now()`, a short retry interval, an overall timeout, and a thrown message containing the label and serialized last observation.
Keep the helper generic so all interaction assertions share one timeout and diagnostic shape.

- [ ] **Step 4: Add wheel zoom and cursor-anchor assertions**

Read `#inner` transform and the first node bounding box before the event, move the Playwright mouse to the node center, and send `mouse.wheel(0, -120)`.
Assert eventually that scale increases and that the node point beneath the cursor moves by no more than 1 CSS pixel in each axis.

- [ ] **Step 5: Add graph pan and outside-release assertions**

Drag from an empty point in `#root` by 40 CSS pixels horizontally and 25 vertically, then assert the transform translation changes by the same values within 1 CSS pixel.
Start a second drag, move outside the webview, release there, move again, and assert translation remains unchanged after release.

- [ ] **Step 6: Add minimap viewport and drag assertions**

Read `#root`, `#inner svg`, `#minimap`, and `#minimap-vp` rectangles, derive the expected viewport rectangle from the main transform and measured dimensions, and compare position and size within 1 CSS pixel.
Drag inside `#minimap` and assert that the main transform translation changes while scale remains unchanged.

- [ ] **Step 7: Add node double-click navigation assertion**

Double-click `g.node[data-node-id="design"]`, then query the workbench editor through stable accessibility roles and assert that the active line contains the first `design` occurrence from `01-simple-chain.pfdsl`.
If VS Code exposes no stable accessibility state for the selection, assert the visible editor line highlight and document title together, and record that fallback in a comment next to the selector.

- [ ] **Step 8: Run each falsification and the complete Green path**

For each scenario, temporarily invert one assertion, verify `pnpm --filter pfdsl test:smoke` FAILs with the scenario name and last observed geometry, then restore it.
Run the restored command three consecutive times to detect immediate flakiness.

Expected: all three restored runs PASS without fixed sleeps or retries at the command level.

- [ ] **Step 9: Commit the interaction coverage**

```bash
git add packages/vscode-extension/smoke/harness.mjs packages/vscode-extension/smoke/harness.test.mjs packages/vscode-extension/smoke/run.mjs
git commit -m "test(vscode): cover preview interactions"
```

### Task 4: Integrate the Smoke Test into CI and Documentation

**Files:**
- Modify: `.github/workflows/test.yml`
- Modify: `packages/vscode-extension/README.md`
- Modify: `Makefile`

**Interfaces:**
- Consumes: Task 3 `pnpm --filter pfdsl test:smoke` command.
- Produces: `make test-vscode-smoke` for local/CI use and an Ubuntu xvfb CI step.

- [ ] **Step 1: Add the Make target before its implementation**

Add a temporary test invocation that demonstrates the target is absent:

Run: `make test-vscode-smoke`

Expected: FAIL with `No rule to make target 'test-vscode-smoke'`.

- [ ] **Step 2: Implement the local smoke target**

```make
.PHONY: test-vscode-smoke
test-vscode-smoke: vscode-build
	pnpm --filter pfdsl test:smoke
```

Run: `make test-vscode-smoke`

Expected: PASS after building dependencies and the extension.

- [ ] **Step 3: Add the Linux CI invocation**

Add this step after `pnpm -r test` in `.github/workflows/test.yml`:

```yaml
      - name: Test VS Code webview smoke scenarios
        run: xvfb-run --auto-servernum make test-vscode-smoke
```

Do not mark it as `continue-on-error`; the test must report a real pull-request failure while it is evaluated for required-gate status.

- [ ] **Step 4: Document local use and supported scope**

Add to `packages/vscode-extension/README.md`:

```markdown
## Webview smoke tests

Run `make test-vscode-smoke` from the repository worktree root.
The command downloads the pinned VS Code test binary on first use, starts it with an isolated profile, and verifies preview rendering, zoom, pan, minimap interaction, outside release, and node navigation through the real webview.
Failures report the VS Code version, webview frame URL, extension-host output, and last observed geometry.
The smoke test does not compare screenshots or cover OS-native dialogs, IME input, or the Marketplace-installed extension.
```

- [ ] **Step 5: Run focused and repository verification**

Run: `pnpm --filter pfdsl test:smoke:unit`

Run: `make test-vscode-smoke`

Run: `pnpm --filter pfdsl test`

Run: `pnpm --filter pfdsl typecheck`

Run: `make lint`

Run: `make check-docs`

Expected: every command exits 0.

- [ ] **Step 6: Commit CI and documentation**

```bash
git add .github/workflows/test.yml Makefile packages/vscode-extension/README.md
git commit -m "ci: run VS Code webview smoke tests"
```

### Task 5: Complete the Project Gate and Review Records

**Files:**
- Modify only files required by findings from the mandated reviews.

**Interfaces:**
- Consumes: all prior commits and `node scripts/gate-check.mjs --base main --no-artifact --issue 891`.
- Produces: a gate-clean branch with required review trailers and no unrelated changes.

- [ ] **Step 1: Run the full trusted-worktree checks**

Run the repository wrappers for test, build, and typecheck with `/Users/m5/works/pfdsl/.worktrees/issue-891-webview-smoke` and the current branch.

Expected: all wrappers exit 0.

- [ ] **Step 2: Run lightweight quality and independent design/correctness reviews**

Run the required four-angle simplify review.
Run an independent design review without revealing the adopted answer, then test whether the implementation satisfies the adoption rationale and falsify every new factual claim in comments, README prose, and diagnostics.
Record the actual tools used in commit trailers as required by `.pfdsl/roadmap.md`.

- [ ] **Step 3: Apply each accepted review finding as its own logical commit**

For every accepted finding, add or tighten a failing test first, run it to Red, implement the minimum fix, rerun to Green, and commit only that finding.
Do not rewrite prior pushed history.

- [ ] **Step 4: Run the cycle gate**

Run: `node scripts/gate-check.mjs --base main --no-artifact --issue 891`

Expected: all machine-checkable rows PASS or documented non-applicable rows SKIP, with no FAIL rows.

- [ ] **Step 5: Verify branch scope**

Run: `git diff --check origin/main...HEAD`

Run: `git status --short`

Run: `git log --oneline origin/main..HEAD`

Expected: no whitespace errors, a clean worktree, and only the design plus #891 implementation commits.
