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
	pnpm --filter @pfdsl/preview-engine build

.PHONY: vscode-build
vscode-build: build-deps
	pnpm --filter @pfdsl/vscode-extension build

.PHONY: vscode-dev
vscode-dev: vscode-build
	code packages/vscode-extension

.PHONY: vscode-watch
vscode-watch: build-deps
	pnpm --filter @pfdsl/vscode-extension watch
