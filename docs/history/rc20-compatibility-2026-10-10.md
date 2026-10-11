# RC20 Vibe 2.26.1 compatibility review

## Decision

RC20 may support **exactly Vibe 2.26.1** through the enforced `--legacy-harness` programmatic path. The TypeScript pin and isolated Python shim now both require `2.26.1`; all other versions fail closed. This review does not establish support for other Vibe versions, operating systems, Python builds, hosted inference, desktop registration, or clean-account installation.

The audit used the installed Mistral Vibe distribution at `/Users/roman/.local/share/uv/tools/mistral-vibe`, its Python 3.12 interpreter, and the cached 2.25.8 source at `/Users/roman/.cache/uv/archive-v0/xJRdBkvzHVH7UYw658Cah` as the comparison baseline. `vibe --version` reported `vibe 2.26.1`; package metadata and `vibe.__version__` both reported `2.26.1`.

No hosted inference was started. The profile integration fixture removes `MISTRAL_API_KEY`; its purpose is to resolve actual configuration and permissions locally, not to run a model. No credentials, session history, prompt arguments, or reasoning were read or recorded.

## Reviewed behavior

- The programmatic launch continues to pass `--legacy-harness`. In 2.26.1, `resolve_harness_selection` gives that flag precedence and selects the legacy path. The Rust rollout explicitly treats `--legacy-harness` as Python-only and bypasses Rust dispatch.
- The changed `vibe/core/agent_loop/_loop.py` does not change permission execution: the AST for `_should_execute_tool` is identical between 2.25.8 and 2.26.1. It still checks the explicit permission bypass first, then the tool's resolved permission, then configured permission, and applies the same NEVER/ALWAYS/ASK decisions.
- `ToolManager.get_tool_config` changed in 2.26.1. Its fallback permission is now an explicit `default_permission` parameter defaulting to `ToolPermission.ASK`, equivalent to the old `BaseToolConfig()` default. Configured tool values and the session permission-store override retain the same merge precedence. Tool discovery adds an LRU cache keyed by search path and the listed Python files; the isolated supervisor profile does not enable project tool discovery.
- The vendored 2.26.1 file helper delegates to `_sandbox_helper`. On the legacy launch path reviewed here, `sandbox` is unset, so the helper receives the session workspace roots and working directory as the path boundary. It continues to resolve paths before use, refuses an out-of-root resolved path, opens through `O_NOFOLLOW` where supported, and verifies regular files. Sandbox-only path-space routing is not selected.
- Agent registry, agent profile, environment/default/project config layers, tool base/permission utilities, and the project discovery manager are byte-identical to the cached 2.25.8 versions (hashes below).
- The project discovery module hash remains `43fc21e2d1a7359ac896ab41e902d927d363ba4ef8f989909af8bcca4b82cbac`, exactly the value enforced by the shim. Its `project_source_enabled` and `project_roots` property signatures remain `self`; the shim disables both before Vibe starts.
- `SessionLogger` has the same reviewed module hash as 2.25.8. The shim's three guarded signatures remain `_persist_messages_sync(messages, session_dir)`, `_overwrite_messages_sync(messages, session_dir)`, and `_persist_metadata_sync(metadata, session_dir)`.
- The parent-death watchdog remains supervisor-owned and uses only the standard Python modules it imports before entering Vibe. Its focused process-group/watchdog tests pass with the installed Vibe interpreter. The 2.26.1 CLI's signal handling does not replace or relax the supervisor's bounded termination path.

## Installed source hashes

SHA-256 values below are for source files in the installed 2.26.1 distribution and the locally cached 2.25.8 comparison source. `MISSING` means the module did not exist in that baseline.

| Source file | Vibe 2.25.8 | Vibe 2.26.1 |
|---|---|---|
| `vibe/core/config/harness_files/_harness_manager.py` | `43fc21e2d1a7359ac896ab41e902d927d363ba4ef8f989909af8bcca4b82cbac` | `43fc21e2d1a7359ac896ab41e902d927d363ba4ef8f989909af8bcca4b82cbac` |
| `vibe/core/session/session_logger.py` | `4f96dae206bca7d7f4f38465bf44bba0cabb117db097d20d647247dd2ad57440` | `4f96dae206bca7d7f4f38465bf44bba0cabb117db097d20d647247dd2ad57440` |
| `vibe/core/agents/manager.py` | `c1a7b7064de7a8ff2e92e91ad0615783af935ab6cce971d5c5fd020bc0419444` | `c1a7b7064de7a8ff2e92e91ad0615783af935ab6cce971d5c5fd020bc0419444` |
| `vibe/core/agents/registry.py` | `95791c2ea9cf13d8eb4f181623b10f26dc3405ff8135e60e0315c37c8d5f6407` | `95791c2ea9cf13d8eb4f181623b10f26dc3405ff8135e60e0315c37c8d5f6407` |
| `vibe/core/agents/models.py` | `28015a29ad37b759c67b89d75e1cd38985ef50b3351f546dc801184debd65b68` | `28015a29ad37b759c67b89d75e1cd38985ef50b3351f546dc801184debd65b68` |
| `vibe/core/config/layers/agent_profile.py` | `a252e3773cce8fac025dcd458ccdeef62e37ebc95a4829fea0176a381265272f` | `a252e3773cce8fac025dcd458ccdeef62e37ebc95a4829fea0176a381265272f` |
| `vibe/core/config/layers/project.py` | `a4c9758cedfa18f494deabf2964708cc02d9e539d15e89a10152277bb87e02f4` | `a4c9758cedfa18f494deabf2964708cc02d9e539d15e89a10152277bb87e02f4` |
| `vibe/core/config/layers/environment.py` | `c93106796f107df323230b56c9cb7dc7905f44c743f17092828a131d8f46a78f` | `c93106796f107df323230b56c9cb7dc7905f44c743f17092828a131d8f46a78f` |
| `vibe/core/config/layers/default.py` | `e55b174000f5b4982d8871869cd85422108fd8fb592739431815890cf7d1de82` | `e55b174000f5b4982d8871869cd85422108fd8fb592739431815890cf7d1de82` |
| `vibe/core/config/builder.py` | `a4f1fd48c276295cf39dff0e5b2d7cf35b44534f43f1c5a07f41eb8d1b901c05` | `a4f1fd48c276295cf39dff0e5b2d7cf35b44534f43f1c5a07f41eb8d1b901c05` |
| `vibe/core/tools/base.py` | `70d706fa373afb9cd5beba6fe50e58720b929017aae0a752949763255cc9ccc2` | `70d706fa373afb9cd5beba6fe50e58720b929017aae0a752949763255cc9ccc2` |
| `vibe/core/tools/utils.py` | `0c755ecd5ed05c3e464feb410800b26cf85cd5581664ca1a86a4c4a0dc9a7a96` | `0c755ecd5ed05c3e464feb410800b26cf85cd5581664ca1a86a4c4a0dc9a7a96` |
| `vibe/core/tools/permissions.py` | `add097139add377e9b68bcb35b0128c1e1eedfa714056b78b31d6183824df0e7` | `add097139add377e9b68bcb35b0128c1e1eedfa714056b78b31d6183824df0e7` |
| `vibe/permissions.py` | `c5d301ea9767cdd8269a455011dfcfdb0e03e4c5dc7fb5c2a12f148284027aec` | `c5d301ea9767cdd8269a455011dfcfdb0e03e4c5dc7fb5c2a12f148284027aec` |
| `vibe/core/agent_loop/_loop.py` | `9784cdbc24a863352119bf31b958642c8db0cd0341974d18400dd4e016a68bf4` | `15250197fe9f9cfdf0a808428c645b2f59810644c3ba4acd3a36407063dc3ba4` |
| `vibe/core/tools/manager.py` | `3818d43817887e4341f4f64b56d8b8cf1b83d35d858761c50e1bcf95d2ec5db3` | `a2d5fc658504fd0055f7c16825731b00011e7ae2ffdb51ad95828dc63881659b` |
| `mistralai_vibe_local_harness/vibe/_file_tools.py` | `b006b48489ca4421e96084dc9d72037106e5c3d6e120d46db3cd8a14ef3e350d` | `57befc06096070fd4f40188d0566743444fc017b5615961a5038878e15a78bad` |
| `mistralai_vibe_local_harness/vibe/_runtime_config.py` | `f1ea1efd31f51633bd02ae108b9fc965afb4158aed129eef7671222009edc110` | `c50d5f2c4a66d92547e7d41c13e602d9926ed73fbe617f6965c56b82049aff05` |
| `mistralai_vibe_local_harness/vibe/_sandbox_helper.py` | `MISSING` | `10526afbf5402170e4dcea190ec50090d2886ceb5352de416b7191cb8048d8c3` |
| `mistralai_vibe_local_harness/vibe/_sandbox.py` | `MISSING` | `c11f24ae7846b0436e4e919b8f4705345d5012b4e2877d4533a02c02701d00bb` |
| `vibe/cli/entrypoint.py` | `7316a251e8b245a51ed62b6b6f1d952d337861894cb03bfee825267ed45baed4` | `fbb033ec73433bc575211680308f287f4bc26a3857f1100f55988de79bad0bb1` |
| `vibe/cli/programmatic.py` | `1dbfd951bba336721cd31aee97a672d219933144e7cde357b485d01908a0a214` | `a938d2440ff5599fa1c48f131c8d6d1ac336aec8cd496c1f8a7caa85c92bbbc1` |
| `vibe/cli/_rust.py` | `69c03410c6bfd73a3b315430a5bdedab89013b4d86bef1cdcfd2640477b08c42` | `edb8a83958fb7aea31b9bf777c1dcb10c6ddaabce1917e3e6535be628724b13c` |
| `vibe/app_server/local.py` | `2fe89f2b0374de33386f8f4c9725e85a2b5b85f04c75834014adbeefa479205f` | `3bf3014d24a5a666254b73d0df29649558e81c6a47aa388ff94602347d6d2e64` |
| `vibe/_experimental_harness.py` | `23521cfca587f5683126d51d807b767c33a1bd2159e178c7a864411badadf4e2` | `eace7ceb43ea8913fe94d37a30b88eb183e18b5901f013e12461f72c8fb7cebf` |

## Effective profile verification

Command run:

```sh
PATH=/Users/roman/.nvm/versions/node/v24.21.0/bin:$PATH \
VIBE_SUPERVISOR_TEST_VIBE_PYTHON=/Users/roman/.local/share/uv/tools/mistral-vibe/bin/python3 \
npm test -- --run tests/unit/profile.test.ts
```

Result: 5 tests passed. The installed 2.26.1 resolver reported only `read_file` and `grep` in review mode, and only `read_file`, `grep`, `write_file`, and `edit` in edit mode. For every enabled tool, the fixture checked workspace root, immediate/nested/deep paths, dot-env/key files, Git and project-agent paths, outside/sibling paths, and a symlink escape. Only the four in-root ordinary paths resolved to ALWAYS; all sensitive, reserved, out-of-root, sibling, and symlink cases resolved to NEVER. The fixture creates hostile project instruction and skill data and verifies they remain excluded. It does not run a Vibe inference.

## Checks run

After rebuilding `dist` from the updated source pins:

- `npm run build` — passed.
- Focused TypeScript suites for profile, doctor/CLI, setup, launcher, CLI entrypoint, backend startup, watchdog, failure reporting, and recovery — 9 files, 107 tests passed.
- Installed-interpreter Python runtime suite (`test_prompt_file`, `test_keychain_credential`, `test_worker_watchdog`, `test_worker_diagnostics`, `test_project_discovery`, `test_vibe_supervisor_launcher`) — 73 tests passed.

The compatibility code changes are limited to the exact runtime pins and their focused fixtures. `2.25.8` is explicitly tested as rejected before credential lookup. The existing project-source hash check, logger signature checks, private homes, environment filtering, prompt-file handoff, and supervisor watchdog remain fail-closed.
