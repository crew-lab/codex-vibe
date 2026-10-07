# ADR 0001: Private unpublished release candidate

Status: accepted for evaluation only.

The project preserves its existing MIT license and `Copyright (c) 2026 crew-lab` notice. The npm package remains `private: true` and is not published from this workflow; that distribution setting does not revoke MIT rights granted by the source license. Release verification separates deterministic local checks from hosted authentication, desktop registration, macOS Intel, fresh-account, and real-hosted ACP soak gates. Those external gates remain unverified until performed and recorded. No user-global configuration is modified by CI or package smoke tests.
