
.PHONY: push

KEYCHAIN_SERVICE := crew-lab-codex-vibe-github-token
KEYCHAIN_ACCOUNT := codex-vibe

push:
	@GIT_TERMINAL_PROMPT=0 git \
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
		}; f' \
		push origin main