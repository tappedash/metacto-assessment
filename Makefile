# Needs Hub — local automation.
#   make            same as `make run`: everything from a fresh clone to a running app
#   make help       list all targets
#
# Wraps the npm scripts in package.json and docker-compose.yml; it adds no new tooling.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := run
MAKEFLAGS += --no-print-directory

# Preferred app port; the next free port is used if it is taken.
PORT ?= 3000
NODE_MIN := 20.12
MAILPIT_URL := http://localhost:8025

BOLD := \033[1m
DIM := \033[2m
OK := \033[32m
WARN := \033[33m
ERR := \033[31m
END := \033[0m

.PHONY: help run dev start doctor env install docker up wait migrate seed setup \
        check typecheck test test-integration build health status logs mail \
        down reset clean

help: ## List targets
	@printf "$(BOLD)Needs Hub$(END) — local commands\n\n"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "} {printf "  $(BOLD)make %-17s$(END) %s\n", $$1, $$2}'
	@printf "\n$(DIM)Variables: PORT=$(PORT) (preferred app port)$(END)\n"

# ---------------------------------------------------------------- one command

run: setup dev ## Everything: prerequisites, .env, deps, Docker, migrate, seed, then start the app

dev: ## Start the dev server on PORT (or the next free port)
	@port=$$($(MAKE) -s free-port); \
	$(call auth-url-for,$$port); \
	printf "\n$(OK)Needs Hub$(END) → $(BOLD)http://localhost:$$port$(END)   (Mailpit: $(MAILPIT_URL))\n"; \
	printf "$(DIM)Sign in with a demo email (magic link arrives in Mailpit); Ctrl+C to stop. See README.$(END)\n\n"; \
	echo $$port > .dev-port; \
	BETTER_AUTH_URL=http://localhost:$$port npx next dev -p $$port

start: setup build ## Production build, then serve it on PORT (or the next free port)
	@port=$$($(MAKE) -s free-port); \
	$(call auth-url-for,$$port); \
	printf "\n$(OK)Needs Hub (production build)$(END) → $(BOLD)http://localhost:$$port$(END)\n\n"; \
	echo $$port > .dev-port; \
	BETTER_AUTH_URL=http://localhost:$$port npx next start -p $$port

# ---------------------------------------------------------------- setup steps

setup: doctor env install up migrate seed ## Prepare everything without starting the app
	@printf "$(OK)✓ Setup complete$(END)\n"

doctor: ## Check Node.js, npm and Docker are available
	@command -v node >/dev/null || { printf "$(ERR)✗ Node.js not found. Install Node $(NODE_MIN)+ (see .nvmrc).$(END)\n"; exit 1; }
	@node -e 'const [a,b]=process.versions.node.split(".").map(Number),[x,y]="$(NODE_MIN)".split(".").map(Number);process.exit(a>x||(a===x&&b>=y)?0:1)' \
		|| { printf "$(ERR)✗ Node $$(node -v) is too old; need $(NODE_MIN)+ (nvm use).$(END)\n"; exit 1; }
	@command -v npm >/dev/null || { printf "$(ERR)✗ npm not found.$(END)\n"; exit 1; }
	@command -v docker >/dev/null || { printf "$(ERR)✗ Docker not found. Install Docker Desktop.$(END)\n"; exit 1; }
	@docker compose version >/dev/null 2>&1 || { printf "$(ERR)✗ Docker Compose v2 not found.$(END)\n"; exit 1; }
	@printf "$(OK)✓$(END) node $$(node -v) · npm $$(npm -v) · $$(docker --version | cut -d, -f1)\n"
	@$(MAKE) -s docker

docker: ## Make sure the Docker daemon is running (starts Docker Desktop on macOS)
	@if docker info >/dev/null 2>&1; then exit 0; fi; \
	if [ "$$(uname)" = "Darwin" ] && [ -d /Applications/Docker.app ]; then \
		printf "$(WARN)… Starting Docker Desktop$(END)\n"; open -a Docker; \
		for i in $$(seq 1 60); do docker info >/dev/null 2>&1 && { printf "$(OK)✓$(END) Docker is running\n"; exit 0; }; sleep 2; done; \
	fi; \
	printf "$(ERR)✗ Docker daemon is not running. Start Docker and retry.$(END)\n"; exit 1

env: ## Create .env from .env.example if missing, and generate BETTER_AUTH_SECRET if empty
	@if [ -f .env ]; then printf "$(OK)✓$(END) .env present\n"; \
	else cp .env.example .env && printf "$(OK)✓$(END) Created .env from .env.example (AI_PROVIDER=mock, no API key needed)\n"; fi
	@grep -q '^BETTER_AUTH_SECRET=..*' .env || { \
		secret=$$(openssl rand -base64 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'); \
		if grep -q '^BETTER_AUTH_SECRET=' .env; then sed -i.bak "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$$secret|" .env && rm -f .env.bak; \
		else printf '\nBETTER_AUTH_SECRET=%s\nBETTER_AUTH_URL=http://localhost:3000\n' "$$secret" >> .env; fi; \
		printf "$(OK)✓$(END) Generated BETTER_AUTH_SECRET in .env\n"; }

install: ## Install npm dependencies (only when package-lock.json changed)
	@if [ -d node_modules ] && [ node_modules/.package-lock.json -nt package-lock.json ]; then \
		printf "$(OK)✓$(END) Dependencies up to date\n"; \
	else npm ci --no-audit --no-fund; fi

up: docker ## Start Postgres (pgvector) and Mailpit and wait until healthy
	@out=$$(docker compose up -d --wait 2>&1) || { echo "$$out" | tail -5; \
		printf "$(ERR)✗ Containers did not start. If a port is taken, change DB_PORT and DATABASE_URL in .env.$(END)\n"; exit 1; }
	@printf "$(OK)✓$(END) Postgres + Mailpit healthy\n"

migrate: ## Apply database migrations
	@npm run -s db:migrate >/dev/null && printf "$(OK)✓$(END) Migrations applied\n"

seed: ## Reset demo data (safe to re-run)
	@npm run -s db:seed

# ---------------------------------------------------------------- quality

check: typecheck test test-integration build ## Run every check: types, unit, integration, build
	@printf "$(OK)✓ All checks passed$(END)\n"

typecheck: ## TypeScript check
	@npm run -s typecheck && printf "$(OK)✓$(END) Types OK\n"

test: ## Unit tests (no database needed)
	@npm test

test-integration: up migrate ## Full workflow + matching tests (reseeds first)
	@npm run test:integration

build: ## Production build
	@npm run build

# ---------------------------------------------------------------- operations

# The port `make dev` / `make start` actually used (another app may hold 3000); PORT=... overrides.
APP_PORT = $(if $(filter command line,$(origin PORT)),$(strip $(PORT)),$(or $(shell cat .dev-port 2>/dev/null),$(strip $(PORT))))

health: ## Call /api/health on the running app (the port make dev chose, or PORT=...)
	@curl -fsS "http://localhost:$(APP_PORT)/api/health" | (command -v python3 >/dev/null && python3 -m json.tool || cat) \
		|| { printf "$(ERR)✗ App not reachable on port $(APP_PORT). Run make dev, or pass PORT=<port>.$(END)\n"; exit 1; }

status: ## Show container status
	@docker compose ps

logs: ## Follow Postgres and Mailpit logs
	@docker compose logs -f

mail: ## Open the Mailpit inbox
	@{ command -v open >/dev/null && open $(MAILPIT_URL); } || { command -v xdg-open >/dev/null && xdg-open $(MAILPIT_URL); } || echo "Open $(MAILPIT_URL)"

down: ## Stop containers (keeps data)
	@docker compose down
	@printf "$(OK)✓$(END) Containers stopped (data kept)\n"

reset: up ## Drop the database, migrate and seed from scratch
	@npm run -s db:reset

clean: ## Stop containers and delete the local database volume and build output
	@docker compose down -v
	@rm -rf .next
	@printf "$(OK)✓$(END) Containers, database volume and .next removed (run make to start fresh)\n"

# ---------------------------------------------------------------- internal

# Sign-in links and OAuth callbacks must use the port the app really runs on.
define auth-url-for
configured=$$(grep -E '^BETTER_AUTH_URL=' .env 2>/dev/null | cut -d= -f2-); \
if [ -n "$$configured" ] && [ "$$configured" != "http://localhost:$(1)" ]; then \
	printf "$(WARN)! Port $(1) is in use instead of $$configured; using BETTER_AUTH_URL=http://localhost:$(1) for this run.$(END)\n"; \
	printf "$(WARN)  Google sign-in needs http://localhost:$(1)/api/auth/callback/google as an authorized redirect URI (magic links work as is).$(END)\n"; \
fi
endef

.PHONY: free-port
free-port:
	@p=$(strip $(PORT)); \
	in_use() { if command -v lsof >/dev/null; then lsof -nP -iTCP:$$1 -sTCP:LISTEN >/dev/null 2>&1; \
		else (exec 3<>/dev/tcp/127.0.0.1/$$1) 2>/dev/null; fi; }; \
	while in_use $$p; do p=$$((p+1)); done; echo $$p
