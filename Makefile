# link-repo-skill.mjs points .claude/skills/pfdsl (gitignored, #348) at the tracked generated copy, a symlink that lets a branch switch synchronise the skill an agent reads through git (#714).
# It used to be a separately generated directory, which needed a built CLI to bootstrap and silently kept the previous branch's version until someone re-ran the generator.
.PHONY: setup setup-unlocked
setup:
	node scripts/setup-completion.mjs run

setup-unlocked:
	rm -f node_modules/.pfdsl-setup-complete
	pnpm install
	@git_common_dir=$$(git rev-parse --git-common-dir) && \
			cp scripts/hooks/pre-commit-shim "$$git_common_dir/hooks/pre-commit" && \
			chmod +x "$$git_common_dir/hooks/pre-commit" && \
			node scripts/link-repo-skill.mjs && \
			node scripts/setup-completion.mjs write

.PHONY: build
build:
	pnpm -r build

.PHONY: test
test:
	pnpm -r test
	node --test "scripts/*.test.mjs" "scripts/lib/*.test.mjs" "scripts/pfdsl/*.test.mjs" "scripts/pfdsl/lib/*.test.mjs" "hooks/*.test.mjs" "hooks/lib/*.test.mjs" "plugin/pfdsl/hooks/lib/*.test.mjs" "plugin/pfdsl-codex/hooks/lib/*.test.mjs" "packages/vscode-extension/smoke/*.test.mjs"
	node scripts/check-script-imports.mjs
	node scripts/check-no-shell-strings.mjs
	node scripts/check-cli-conventions.mjs

.PHONY: coverage
coverage:
	pnpm -r coverage

.PHONY: typecheck
typecheck:
	pnpm -r typecheck

.PHONY: lint
lint:
	node scripts/check-biome.mjs .

.PHONY: format
format:
	pnpm biome check --write .

.PHONY: build-deps
build-deps:
	pnpm --filter @pfdsl/core build
	pnpm --filter @pfdsl/graphviz-exporter build
	pnpm --filter @pfdsl/metadata-exporter build
	pnpm --filter @pfdsl/preview-engine build
	pnpm --filter @pfdsl/cli build

.PHONY: vscode-build
vscode-build: build-deps
	pnpm --filter pfdsl build

.PHONY: test-vscode-smoke
test-vscode-smoke: vscode-build
	pnpm --filter pfdsl test:smoke

# One command to start a dev session: build, open the extension window, then
# watch for changes in the foreground (Ctrl+C to stop).
.PHONY: vscode-dev
vscode-dev: vscode-build
	code packages/vscode-extension
	@echo ""
	@echo "Opened $(CURDIR)/packages/vscode-extension"
	@echo "  (run this from your worktree root, not the main repo, or you debug stale code)"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Press F5 in the opened VSCode window to launch the Extension Development Host"
	@echo "  2. Open a .pfdsl file, then run 'PFDSL: Open Preview to the Side'"
	@echo "  3. Edit code -> reload the Dev Host (Cmd+R); the watch below keeps dist fresh"
	@echo "  4. Debugging the webview console? Filter by 'takasek.pfdsl'"
	@echo ""
	@echo "Watching for changes (Ctrl+C to stop)..."
	pnpm --filter pfdsl watch

# VS Code release preparation leaves the version diff for the normal PR flow.
.PHONY: vscode-package
vscode-package: vscode-build
	node scripts/release.mjs vscode publish $(if $(COMMIT),--commit $(COMMIT))

.PHONY: vscode-prepare
vscode-prepare:
	node scripts/release.mjs vscode prepare $(if $(VERSION),--version $(VERSION))

.PHONY: gen-samples
gen-samples: build-deps
	node scripts/gen-samples.mjs

.PHONY: gen-readme-cli
gen-readme-cli:
	node scripts/gen-readme-cli.mjs

.PHONY: check-readme-cli
check-readme-cli:
	node scripts/gen-readme-cli.mjs
	@git diff --exit-code README.md packages/cli/README.md || (echo "A README's CLI section is stale. Run 'make gen-readme-cli' and commit the result." && exit 1)

# Canonical-fmt guard for operational .pfdsl/ files and the distributed
# scaffold's .pfdsl/ templates (#529, #685). docs/ teaching material is
# exempt, since fmt can materialize implied nodes there.
.PHONY: check-fmt
check-fmt:
	@find .pfdsl .claude/skills/pfd-ops/references/scaffold -name "*.pfdsl" -type f | sort | while read f; do \
		echo "fmt --check $$f"; \
		node packages/cli/dist/cli.js fmt "$$f" --check || \
			{ echo "$$f is not canonically formatted. Run 'make fmt-pfdsl' and commit the result."; exit 1; }; \
	done
	@echo "check-fmt: all passed"

# location: の参照先実在ガード。スコープは check-fmt と同じ理由で運用 .pfdsl のみ
# — docs/ の教材と core の fixture は例示パスを意図して持つので、解決することは
# そもそもそれらの性質ではない（#937）。pre-commit 側の対は drift-gates.mjs の
# pfdsl-links ゲートで、そちらは staged 分だけを見る。両方要るのは、他所のファイル
# 移動で壊れた location: は当の .pfdsl を触らないコミットでは staged に現れないため。
.PHONY: check-links
check-links: check-pfdsl
	@files=$$(find .pfdsl -maxdepth 1 -name "*.pfdsl" -type f | sort); \
	if [ -z "$$files" ]; then \
		echo "check-links: no operational .pfdsl found — the scope moved, so this target checks nothing. Fix it before trusting the green."; \
		exit 1; \
	fi; \
	for f in $$files; do \
		echo "check-links $$f"; \
		node packages/cli/dist/cli.js meta check-links "$$f" || \
			{ echo "$$f has a location: that does not resolve. Fix the path or restore the file."; exit 1; }; \
	done; \
	echo "check-links: all passed"

# Runs `check` (non-strict) against operational .pfdsl/. Unlike check-scaffold
# (--strict, distributed scaffold only), operational files carry in-flight
# status and are deliberately exempt from --strict, so this target has to
# exist on its own for a rule like V035 (#1125) to ever fire against them —
# check-scaffold's --strict scope never reaches .pfdsl/, and check-docs
# scopes to docs/. Wired as a check-links prerequisite so the existing CI
# step (`make check-links`) runs it too, rather than adding a new CI step.
.PHONY: check-pfdsl
check-pfdsl:
	@find .pfdsl -maxdepth 1 -name "*.pfdsl" -type f | sort | while read f; do \
		echo "check $$f"; \
		node packages/cli/dist/cli.js check "$$f" || exit 1; \
	done
	@echo "check-pfdsl: all passed"

# The distributed scaffold must pass the check the skills themselves
# prescribe: pfd-grill gates on `check --strict` and pfd-ecosystem on
# `check`, so a scaffold that fails either hands every adopting repo a file
# that fails their own gate the moment they copy it. check-fmt above covers
# formatting only, which is how a strict-mode failure survived it (found by
# the 2026-08-04 distribution review). Operational .pfdsl/ files are exempt
# here — they carry statuses and in-flight nodes that strict mode rejects by
# design.
.PHONY: check-scaffold
check-scaffold:
	@find .claude/skills/pfd-ops/references/scaffold -name "*.pfdsl" -type f | sort | while read f; do \
		echo "check --strict $$f"; \
		node packages/cli/dist/cli.js check "$$f" --strict || \
			{ echo "$$f fails the check the skills prescribe for adopting repos."; exit 1; }; \
	done
	@echo "check-scaffold: all passed"

# Rewrite the operational .pfdsl/ and scaffold .pfdsl/ files to canonical fmt
# (companion to check-fmt).
.PHONY: fmt-pfdsl
fmt-pfdsl:
	@find .pfdsl .claude/skills/pfd-ops/references/scaffold -name "*.pfdsl" -type f | sort | while read f; do \
		node packages/cli/dist/cli.js fmt "$$f" --write || exit 1; \
	done

.PHONY: check-docs
check-docs:
	@find docs -name "*.pfdsl" -type f | sort | while read f; do \
		echo "check $$f"; \
		node packages/cli/dist/cli.js check "$$f" || exit 1; \
		node packages/cli/dist/cli.js render "$$f" --format dot > /dev/null || exit 1; \
	done
	@echo "check-docs: all passed"
	node scripts/check-doc-examples.mjs
	node scripts/check-diag-registry.mjs
	node scripts/check-forward-ref-markers.mjs
	node scripts/check-spec-ids.mjs
	node scripts/check-companion-bindings.mjs
	node scripts/check-distributed-prose.mjs
	node scripts/check-entry-path-headings.mjs
	node scripts/check-skill-wiring.mjs
	node scripts/check-review-perspectives-scale.mjs

.PHONY: gen-skill
gen-skill: check-docs
	node scripts/gen-skill.mjs --out generated/skills/pfdsl

.PHONY: gen-install
gen-install:
	node scripts/gen-install.mjs

.PHONY: gen-plugin
gen-plugin: gen-skill gen-install
	node scripts/gen-plugin.mjs

.PHONY: push
push: check-docs
	@if ! git diff --quiet HEAD -- docs/samples docs/examples plugin .claude-plugin; then \
		echo "docs/samples, docs/examples, plugin, または .claude-plugin に差分があります。コミットしてから push してください。"; \
		git diff --stat HEAD -- docs/samples docs/examples plugin .claude-plugin; \
		exit 1; \
	fi
	$(MAKE) gen-samples
	@if ! git diff --quiet HEAD -- docs/samples; then \
		echo "gen-samples で docs/samples が更新されました。自動コミットします。"; \
		git add docs/samples && git commit -m "chore: regenerate docs/samples"; \
	fi
	$(MAKE) gen-plugin
	@if ! git diff --quiet HEAD -- plugin .claude-plugin; then \
		echo "gen-plugin でプラグインが更新されました。自動コミットします。"; \
		git add plugin .claude-plugin && git commit -m "chore: regenerate plugin"; \
	fi
	git push

.PHONY: release-status
release-status:
	node scripts/release-status.mjs

# Prepare the CLI version diff for a normal PR.
.PHONY: release-prepare
release-prepare:
	node scripts/release.mjs cli prepare $(if $(VERSION),--version $(VERSION))

# Publish the exact merged commit named by COMMIT.
.PHONY: release
release:
	node scripts/release.mjs cli publish $(if $(COMMIT),--commit $(COMMIT))

.PHONY: release-libs-prepare
release-libs-prepare:
	node scripts/release.mjs libs prepare $(if $(VERSION),--version $(VERSION))

.PHONY: release-libs
release-libs:
	node scripts/release.mjs libs publish $(if $(COMMIT),--commit $(COMMIT))
