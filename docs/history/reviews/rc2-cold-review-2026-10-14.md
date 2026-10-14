# Cold review of the 1.0.1-rc.2 source (2026-10-14)

An independent reviewer read the uncommitted rc.2 diff with no design context, then the preparing machine checked each point against the code and the Vibe 2.26.1 tag source. No fail-open path was found: all five pins and both environment profiles are checked before any Vibe class is patched, a refused tool raises before the original `invoke` runs, and the skills check runs before credentials and the entrypoint.

| # | Finding | Resolution |
|---|---|---|
| F1 (medium) | The diagnostics file was read whole before its size was checked, so a huge file would be loaded into the server, and one over 2 GiB would be reported as unsafe | The `lstat` size is checked before reading; the size of the bytes actually read is checked again |
| F2 (low) | The symlink test passed for reasons other than the run manager's own check, and the directory test asserted no reason | The symlink target is now readable, so following it would leak its marker; the directory test asserts the reason |
| F3 (low) | The installed-Vibe check accepted any exception from `ToolManager.get` as a refusal | It requires `NoSuchToolError` naming the tool |
| F4 (low) | The pin-drift test checked only that `invoke` stayed unpatched | It also checks `available_tools` and the saved originals |
| Extra | `VIBE_ENABLED_SKILLS` set to an empty string or `[]` was accepted | Any presence of the variable is refused; the child environment never sets it |

## Questions answered from the v2.26.1 source

- Vibe calls `tool_instance.invoke(ctx=InvokeContext(...), **args)` with keywords only, which matches the wrapper's signature.
- No built-in tool overrides `invoke`. The `task` tool calls a sub-agent runner, but `task` is outside both profiles.
- A refusal is a `PermissionError`, which is an `Exception`. `_execute_tool_call` reports it to the model as a failed tool call, and the run continues.
- The `SkillManager(config_getter, *, harness_files=..., include_builtins=...)` constructor, `available_skills` and `parse_skill_command` all match the installed-Vibe check.

## Still open

- The pre-existing `lstat` then `readFile` window in `describeArtifact`.
- Whether a cancelled inner generator's cleanup can run after `cancelled` is recorded.

Neither affects the profile boundary. Both are noted for a later candidate.
