.PHONY: server serve build book book-serve deploy

CLUSTERD_PROXY_TARGET ?= https://cluster.example.invalid:5050
VERSION ?= 1.0.1
MDBOOK := $(shell command -v mdbook 2>/dev/null)
ifeq ($(MDBOOK),)
MDBOOK := nix shell nixpkgs\#mdbook --command mdbook
endif

all: serve

serve:
	npm install --include=dev --silent && npm run dev -- --host 0.0.0.0

build:
	npm install --include=dev --ignore-scripts --silent && npm run build

book:
	$(MDBOOK) build book

book-serve:
	$(MDBOOK) serve book

deploy: book
	@set -eu; \
	git worktree prune; \
	tmp="$$(mktemp -d)"; \
	trap 'git worktree remove --force "$$tmp" >/dev/null 2>&1 || true; rmdir "$$tmp" 2>/dev/null || true' EXIT; \
	git worktree add --detach "$$tmp" HEAD >/dev/null; \
	if git show-ref --verify --quiet refs/remotes/origin/gh-pages; then \
		git -C "$$tmp" fetch origin gh-pages >/dev/null; \
		git -C "$$tmp" reset --hard origin/gh-pages >/dev/null; \
	fi; \
	find "$$tmp" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +; \
	cp -a book/build/. "$$tmp"/; \
	git -C "$$tmp" add -A; \
	if git -C "$$tmp" diff --cached --quiet; then \
		echo "Documentation unchanged; nothing to deploy."; \
	else \
		git -C "$$tmp" -c user.name="ClusterD docs deploy" -c user.email="docs@localhost" commit -m "Deploy documentation" >/dev/null; \
		git -C "$$tmp" push origin HEAD:refs/heads/gh-pages; \
	fi

