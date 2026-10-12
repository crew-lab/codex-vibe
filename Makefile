.PHONY: push push-branch

KEYCHAIN_SERVICE := crew-lab-codex-vibe-github-token
KEYCHAIN_ACCOUNT := codex-vibe

GIT_WITH_TOKEN = GIT_TERMINAL_PROMPT=0 git \
		-c credential.helper= \
		-c 'credential.helper=!f() { \
			if [ "$$1" = get ]; then \
				printf "username=token\npassword="; \
				/usr/bin/security find-generic-password \
					-a "$(KEYCHAIN_ACCOUNT)" \
					-s "$(KEYCHAIN_SERVICE)" \
					-w; \
				printf "\n"; \
			fi; \
		}; f'

push:
	@$(GIT_WITH_TOKEN) push origin main

push-branch:
	@test -n "$(BRANCH)" || { echo 'Usage: make push-branch BRANCH=<name>' >&2; exit 2; }
	@test "$(BRANCH)" != main || { echo 'Use make push for main' >&2; exit 2; }
	@git check-ref-format --branch "$(BRANCH)" >/dev/null
	@git rev-parse --verify --quiet "refs/heads/$(BRANCH)" >/dev/null || { echo 'No local branch $(BRANCH)' >&2; exit 2; }
	@$(GIT_WITH_TOKEN) push origin "refs/heads/$(BRANCH):refs/heads/$(BRANCH)"
