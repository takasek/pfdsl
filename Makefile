.PHONY: setup
setup:
	pnpm install
	cp scripts/pre-commit $$(git rev-parse --git-common-dir)/hooks/pre-commit
	chmod +x $$(git rev-parse --git-common-dir)/hooks/pre-commit

.PHONY: build
build:
	pnpm -r build

.PHONY: test
test:
	pnpm -r test
	node --test "scripts/lib/*.test.mjs"

.PHONY: typecheck
typecheck:
	pnpm -r typecheck

.PHONY: lint
lint:
	pnpm biome check packages/

.PHONY: format
format:
	pnpm biome check --write packages/

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

# vscode-extension を .vsix にパッケージし vscode-v<version> タグを打って push する。
# VERSION=x.y.z を渡すと package.json を更新してコミットしてからパッケージする。
# tag を打つ前に build/test/check-docs/gen-skill identity を検査する (scripts/release.mjs)。
# 例: make vscode-package VERSION=0.0.13
.PHONY: vscode-package
vscode-package: vscode-build
	node scripts/release.mjs vscode $(if $(VERSION),--version $(VERSION))

.PHONY: gen-samples
gen-samples: build-deps
	node scripts/gen-samples.mjs

.PHONY: gen-readme-cli
gen-readme-cli:
	node scripts/gen-readme-cli.mjs

.PHONY: check-readme-cli
check-readme-cli:
	node scripts/gen-readme-cli.mjs
	@git diff --exit-code README.md || (echo "README.md CLI section is stale. Run 'make gen-readme-cli' and commit the result." && exit 1)

.PHONY: check-docs
check-docs:
	@find docs -name "*.pfdsl" -type f | sort | while read f; do \
		echo "check $$f"; \
		node packages/cli/dist/cli.js check "$$f" || exit 1; \
		node packages/cli/dist/cli.js graph "$$f" --format dot > /dev/null || exit 1; \
	done
	@echo "check-docs: all passed"
	node scripts/check-doc-examples.mjs
	node scripts/check-diag-registry.mjs
	node scripts/check-forward-ref-markers.mjs
	node scripts/check-companion-bindings.mjs

.PHONY: gen-skill
gen-skill: check-docs
	node scripts/gen-skill.mjs --out .claude/skills/pfdsl
	node scripts/gen-skill.mjs --out skills/pfdsl
	# CLAUDE.md is a local-only "do not edit" guard for the in-repo working copy
	# (.claude/skills/pfdsl); it is intentionally absent from the distribution copy
	# (skills/pfdsl) and not emitted by gen-skill, so exclude it from the identity check.
	@diff -rq -x CLAUDE.md .claude/skills/pfdsl skills/pfdsl > /dev/null || (echo "ERROR: .claude/skills/pfdsl and skills/pfdsl differ after gen-skill" && exit 1)

.PHONY: install-skill
install-skill: check-docs
	node scripts/gen-skill.mjs --out "$(HOME)/.claude/skills/pfdsl"

.PHONY: push
push: check-docs
	@if ! git diff --quiet HEAD -- docs/samples docs/examples .claude/skills skills; then \
		echo "docs/samples, docs/examples, .claude/skills, または skills に差分があります。コミットしてから push してください。"; \
		git diff --stat HEAD -- docs/samples docs/examples .claude/skills skills; \
		exit 1; \
	fi
	$(MAKE) gen-samples
	@if ! git diff --quiet HEAD -- docs/samples; then \
		echo "gen-samples で docs/samples が更新されました。自動コミットします。"; \
		git add docs/samples && git commit -m "chore: regenerate docs/samples"; \
	fi
	$(MAKE) gen-skill
	@if ! git diff --quiet HEAD -- .claude/skills skills; then \
		echo "gen-skill でスキルが更新されました。自動コミットします。"; \
		git add .claude/skills skills && git commit -m "chore: regenerate skills"; \
	fi
	git push

.PHONY: release-status
release-status:
	node scripts/release-status.mjs

# @pfdsl/cli を npm 公開する。VERSION= を指定するか packages/cli/package.json の version を使い
# v<version> タグを打って push し、publish-cli.yml (OIDC) を起動する。
# VERSION= を指定した場合は package.json を更新してコミットしてからタグを打つ。
# tag を打つ前に build/test/check-docs/gen-skill identity を検査する (scripts/release.mjs)。
# 例: make release VERSION=0.0.8
.PHONY: release
release:
	node scripts/release.mjs cli $(if $(VERSION),--version $(VERSION))

# ライブラリ群（core/graphviz-exporter/preview-engine）を npm 公開する。
# VERSION= を指定するか packages/core/package.json の version を使い
# lib-v<version> タグを打って push し、publish-libraries.yml (OIDC) を起動する。
# VERSION= を指定した場合は3パッケージの package.json を同時に更新してコミットしてからタグを打つ。
# tag を打つ前に build/test/check-docs/gen-skill identity を検査する (scripts/release.mjs)。
# 例: make release-libs VERSION=0.0.2
.PHONY: release-libs
release-libs:
	node scripts/release.mjs libs $(if $(VERSION),--version $(VERSION))
