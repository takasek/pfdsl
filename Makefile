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
	@find docs -name "*.pfdsl" | sort | while read f; do \
		echo "check $$f"; \
		node packages/cli/dist/cli.js check "$$f" || exit 1; \
		node packages/cli/dist/cli.js graph "$$f" --format dot > /dev/null || exit 1; \
	done
	@echo "check-docs: all passed"

.PHONY: gen-skill
gen-skill: check-docs
	node scripts/gen-skill.mjs --out .claude/skills/pfdsl

.PHONY: install-skill
install-skill: check-docs
	node scripts/gen-skill.mjs --out "$(HOME)/.claude/skills/pfdsl"

.PHONY: push
push: check-docs
	@if ! git diff --quiet HEAD -- docs/samples docs/examples docs/pfdsl_implementation_flow.pfdsl .claude/skills; then \
		echo "docs/samples, docs/examples, docs/pfdsl_implementation_flow.pfdsl, または .claude/skills に差分があります。コミットしてから push してください。"; \
		git diff --stat HEAD -- docs/samples docs/examples docs/pfdsl_implementation_flow.pfdsl .claude/skills; \
		exit 1; \
	fi
	$(MAKE) gen-samples
	@if ! git diff --quiet HEAD -- docs/samples; then \
		echo "gen-samples で docs/samples が更新されました。自動コミットします。"; \
		git add docs/samples docs/pfdsl_implementation_flow.* && git commit -m "chore: regenerate docs/samples"; \
	fi
	git push
