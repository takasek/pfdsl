.PHONY: setup
setup:
	pnpm install
	cp scripts/pre-commit .git/hooks/pre-commit
	chmod +x .git/hooks/pre-commit

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

.PHONY: vscode-dev
vscode-dev: vscode-build
	code packages/vscode-extension
	@echo ""
	@echo "Next steps:"
	@echo "  1. Run 'make vscode-watch' in another terminal"
	@echo "  2. Press F5 in the opened VSCode window"
	@echo "  3. After editing deps (core/graphviz-exporter), run 'make build-deps' then restart watch"

.PHONY: vscode-watch
vscode-watch: build-deps
	pnpm --filter pfdsl watch

.PHONY: vscode-package
vscode-package: vscode-build
	cd packages/vscode-extension && vsce package --no-dependencies

.PHONY: gen-samples
gen-samples: build-deps
	node scripts/gen-samples.mjs

.PHONY: check-docs
check-docs:
	@find docs -name "*.pfdsl" -type f | sort | while read f; do \
		echo "check $$f"; \
		node packages/cli/dist/cli.js check "$$f" || exit 1; \
		node packages/cli/dist/cli.js graph "$$f" --format dot > /dev/null || exit 1; \
	done
	@echo "check-docs: all passed"

.PHONY: gen-skill
gen-skill: check-docs
	node scripts/gen-skill.mjs --out .claude/skills/pfdsl
	node scripts/gen-skill.mjs --out skills/pfdsl
	@diff -rq .claude/skills/pfdsl skills/pfdsl > /dev/null || (echo "ERROR: .claude/skills/pfdsl and skills/pfdsl differ after gen-skill" && exit 1)

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

# @pfdsl/cli を npm 公開する。packages/cli/package.json の version から
# v<version> タグを打って push し、publish-cli.yml (OIDC) を起動する。
# 事前に version を上げてコミット・マージしておくこと。
.PHONY: release
release:
	@VERSION=$$(node -p "require('./packages/cli/package.json').version"); \
	BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$BRANCH" != "main" ]; then echo "main ブランチで実行してください (現在: $$BRANCH)"; exit 1; fi; \
	if [ -n "$$(git status --porcelain)" ]; then echo "作業ツリーに未コミットの変更があります"; exit 1; fi; \
	if git rev-parse "v$$VERSION" >/dev/null 2>&1; then echo "タグ v$$VERSION は既に存在します (version を上げてください)"; exit 1; fi; \
	git fetch origin main --quiet; \
	if [ "$$(git rev-parse HEAD)" != "$$(git rev-parse origin/main)" ]; then echo "ローカル main が origin/main と一致しません。pull してください"; exit 1; fi; \
	echo "v$$VERSION を打って push します (publish-cli.yml が起動)"; \
	git tag "v$$VERSION"; \
	git push origin "v$$VERSION"

# vscode-extension を Marketplace 公開する。packages/vscode-extension/package.json の version から
# ext-v<version> タグを打って push し、publish-extension.yml (VSCE_PAT secret) を起動する。
# 事前に version を上げてコミット・マージしておくこと。GitHub Secrets に VSCE_PAT が必要。
.PHONY: release-extension
release-extension:
	@VERSION=$$(node -p "require('./packages/vscode-extension/package.json').version"); \
	BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$BRANCH" != "main" ]; then echo "main ブランチで実行してください (現在: $$BRANCH)"; exit 1; fi; \
	if [ -n "$$(git status --porcelain)" ]; then echo "作業ツリーに未コミットの変更があります"; exit 1; fi; \
	if git rev-parse "ext-v$$VERSION" >/dev/null 2>&1; then echo "タグ ext-v$$VERSION は既に存在します (version を上げてください)"; exit 1; fi; \
	git fetch origin main --quiet; \
	if [ "$$(git rev-parse HEAD)" != "$$(git rev-parse origin/main)" ]; then echo "ローカル main が origin/main と一致しません。pull してください"; exit 1; fi; \
	echo "ext-v$$VERSION を打って push します (publish-extension.yml が起動)"; \
	git tag "ext-v$$VERSION"; \
	git push origin "ext-v$$VERSION"
