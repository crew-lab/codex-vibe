# Vibe skill and thread-cleanup update — 2026-10-06

This update changes coordinator skills and the UARoute local startup command; it does not weaken Vibe's project-extension, permission, version, or privacy guards. Editing `/ent` does not invoke cleanup or archive the chat.

## Gaps addressed

| Gap | Correction |
|---|---|
| Registration/status success treated as hosted execution | Separate transport, workspace, inference, model evidence and task acceptance. |
| Independent clients compete for one owner lock | Document rc.4 isolated storage and keep each run on its owning connection/home. |
| Root `.agents` breaks startup despite allowlisting | Explain the guard, safe bounded review copies and limits; never delete project skills or bypass the guard. |
| Style findings or mode-switch plans accepted as correctness reviews | Require supported location/trigger/incorrect behavior or an explicit no-defect result. |
| Local cleanup skill ignored | `/ent` discovers and reads applicable project cleanup guidance before default resource decisions. |
| Worker scratch files and temporary plans not accounted for | Assignment inventory and bounded self-cleanup requests to usable owned ACP edit workers; independent coordinator verification. |
| Review/programmatic/closed workers asked to perform unsupported cleanup | Keep reviews read-only; no continuation replay/new run for cleanup; use supervisor/coordinator interfaces. |
| Session directories treated as global disposable storage | Exact ownership/preservation checks; no bulk deletion of homes, locks, histories or other-chat runs. |
| UARoute `npm start` resolves undeclared `serve` using npx | Pin `serve` 14.2.6 as a development dependency, use `serve out`, and update its lockfile/local usage note. |

## Verification

The three skill files passed YAML/frontmatter, name/description, required-section, step-heading and length checks. Their local Markdown links and anchor targets resolved. `/ent` remains explicit-only in `agents/openai.yaml`. Existing cleanup safeguards and the no-execution-on-skill-edit boundary were preserved. The design scenario table now covers local cleanup precedence, temporary plans, Vibe self-cleanup, read-only workers, unusable sessions and other-client private homes. These are instruction/structure reviews, not hosted cleanup or destructive runtime tests.

UARoute's full `npm run check` passed documentation checks, typecheck, lint, 38 tests, catalog validation, static build and output inspection. An owned local test server returned HTTP 200 for exported HTML with offline npm mode and an empty cache (serve update checking disabled); the server and test cache were removed. A fresh `npm ci` accepted the final lockfile and installed serve 14.2.6. The complete dependency tree was not cached, so this fresh-install check used registry access; offline startup does not promise an uncached offline installation. Npm-required optional lock entries were retained, existing dependency versions were unchanged, and unrelated user changes were preserved. Disposable installation directories were removed.

The user skill links point at the repository originals; the existing ent link was retained. No Claude companion is needed for the requested Codex workflow. The updated skills are local source changes, not a rebuilt release tarball or proof of plugin installation. Current hosted evidence remains limited to the reported bounded programmatic review; model identity and direct `.agents` repository support are not established.

## Reference checks

Reviewed the [Agent Skills specification](https://agentskills.io/specification), [official Codex skill guidance](https://learn.chatgpt.com/docs/build-skills), and [ACP prompt/session contracts](https://agentclientprotocol.com/protocol/v1/prompt-turn). Existing handoff comparators remain in the [ent design notes](../../skills/ent/references/design-notes.md); none supplies authority for unrelated deletion.
