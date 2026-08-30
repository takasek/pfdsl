// Explicit list of repo-root-relative paths distributed via the pfd-ops
// skill's install/ mirror (ADR-0015 / #63; redesigned to a one-direction
// generator by #547).
//
// This is a hand-maintained list rather than a glob over scripts/pfdsl/**
// because scripts/pfdsl/ also holds repo-local files (this repo's own
// *.test.mjs suites) that must NOT ship to consumers of the pfd-ops skill.
// Adding a path here is a deliberate "yes, distribute this" decision, and
// scripts/lib/install-templates.test.mjs asserts it stays in sync with what
// actually exists under .claude/skills/pfd-ops/install/.
export const INSTALL_TEMPLATE_PATHS = [
	".github/workflows/pfdsl-flow-on-issue-close.yml",
	"scripts/pfdsl/audit-issues-flow.mjs",
	"scripts/pfdsl/normalize-pfdsl.mjs",
	"scripts/pfdsl/lib/gh-compat.mjs",
	"scripts/pfdsl/lib/gh-exec.mjs",
	"scripts/pfdsl/lib/github-ops.mjs",
	"scripts/pfdsl/lib/github-rest.mjs",
	"scripts/pfdsl/lib/issues-flow-audit.mjs",
	"scripts/pfdsl/lib/proxy-fetch-worker.mjs",
	"scripts/pfdsl/lib/proxy-fetch.mjs",
	"scripts/pfdsl/lib/yaml-require.mjs",
];
