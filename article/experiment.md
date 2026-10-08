# Optional experiment: does a second model find different bugs?

The only way to back the cross-model claim. Run it on the target machine (never on the preparing machine), only with the owner's authorization, since it sends the fixture to Mistral and to OpenAI and is billed.

## Setup

- A small public repository (a few hundred lines, one language the reader knows) with about ten planted bugs of different kinds: off-by-one, missing error handling, unchecked input, a resource leak, a wrong comparison, a race on a shared value, a misleading name hiding a logic error, a dead branch, an incorrect default, a security slip such as a path joined without a check.
- An answer key committed separately, with each bug's file, line and trigger.
- One review prompt, identical for both reviewers, asking for located findings with trigger and incorrect behavior, or an explicit "no defect".

## Runs

1. Codex alone: the review prompt in a fresh Codex chat, its own model and default settings.
2. Vibe through the supervisor: the same prompt passed by Codex to `vibe_review_start`, default limits (20 turns).
3. Optionally, three repetitions each, because model output varies.

## Record

Per run: bugs found (matched to the key by location and trigger), false positives, time to the settled reply, reported cost or usage, `stop_reason`. Keep the transcripts.

## Report

As an anecdote with its sample size, not a benchmark. Publish the repository, the key and the prompts so readers can rerun it. If Vibe finds nothing Codex missed, say so; the safety and workflow benefits stand without this claim.
