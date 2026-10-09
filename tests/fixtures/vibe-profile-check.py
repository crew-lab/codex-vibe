"""No-provider check of the pinned Vibe's real agent loader and path resolver."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys

# This fixture must never make a provider or experiment request.
def refuse_network(*args, **kwargs):
    raise RuntimeError("Network is disabled in the installed-profile fixture")
socket.socket.connect = refuse_network
socket.create_connection = refuse_network

import vibe
# Apply the production isolation shim before any Vibe entrypoint/registry uses
# the harness manager. No provider credential resolution is called here.
spec = importlib.util.spec_from_file_location('profile_launcher', sys.argv[2])
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
launcher._patch_project_discovery()
from vibe.core.agents.manager import AgentManager
from vibe.core.config.harness_files import HarnessFilesManager, init_harness_files_manager
from vibe.core.config.layers.default import DefaultConfigLayer
from vibe.core.config.layers.environment import EnvironmentLayer
from vibe.core.config.layers.agent_profile import AgentProfileLayer
from vibe.core.config.orchestrator import ConfigOrchestrator
from vibe.core.config.vibe_schema import VibeConfigSchema
from vibe.core.tools.base import BaseToolConfig
from vibe.core.tools.permissions import ToolPermission
from vibe.core.tools.utils import resolve_file_tool_permission
from vibe.core.workspace import Workspace

async def main():
    assert vibe.__version__ == "2.25.8", "Wrong installed Vibe version"
    root = Path(sys.argv[1]).resolve()
    init_harness_files_manager('user', 'project')
    class Trusted:
        def is_trusted(self, path):
            return True
    harness = HarnessFilesManager(sources=('user', 'project'), cwd=root, trust_store=Trusted())
    # Include the cwd and extra roots, as ACP session/load and movement do.
    variants = [harness, harness.for_session(root, workspace_roots=[root, root/'nested']), harness.moved_to(root/'nested')]
    for candidate in variants:
        assert candidate.project_source_enabled is False
        assert candidate.project_roots == []
        assert candidate.project_skills_dirs == []
        assert candidate.project_agents_dirs == []
        assert candidate.project_tools_dirs == []
        assert candidate.project_plugins_dirs == []
        assert candidate.project_prompts_dirs == []
        assert candidate.load_project_docs() == []
        assert candidate.find_subdirectory_agents_md(root/'nested'/'file.txt') == []
        assert candidate.config_file == Path(os.environ['VIBE_HOME'])/'config.toml'
        assert candidate.hook_files == [Path(os.environ['VIBE_HOME'])/'hooks.toml']
    defaults = DefaultConfigLayer(schema=VibeConfigSchema)
    orchestrator = await ConfigOrchestrator.create(
        schema=VibeConfigSchema,
        layers=[defaults, EnvironmentLayer(schema=VibeConfigSchema), AgentProfileLayer()],
        default_layer_resolver=lambda: defaults,
    )
    mode = os.environ['VIBE_DEFAULT_AGENT']
    manager = AgentManager(orchestrator, initial_agent=mode, harness_files=harness)
    assert manager.active_profile.source_path == Path(os.environ['VIBE_HOME']) / 'agents' / (mode + '.toml'), 'Built-in fallback selected'
    config = manager.config
    expected = ['read_file', 'grep'] + (['write_file', 'edit'] if mode == 'accept-edits' else [])
    assert set(config.enabled_tools) == set(expected), 'Unexpected tool inventory'
    assert set(manager.available_agents) == {mode}, 'Unexpected agent inventory'
    workspace = Workspace.for_session(root)
    cases = {'root': root, 'immediate': root/'file.txt', 'nested': root/'src/a/b.ts', 'deep': root/'a/b/c/d/e.ts',
             'secret': root/'.env', 'nested_secret': root/'src/a/.env', 'key': root/'src/a/key.pem',
             'git': root/'.git/config', 'project_skill': root/'.agents/skills/hostile/SKILL.md', 'nested_reserved': root/'src/a/.agents/private.txt',
             'outside': root.parent/'outside.txt', 'sibling': root.parent/(root.name+'-sibling')/'file.txt',
             'symlink': root/'escape'}
    result = {}
    for name in expected:
        tool = BaseToolConfig.model_validate(config.tools[name])
        assert tool.permission == ToolPermission.NEVER, (name, 'unsafe fallback')
        decisions = {}
        for label, target in cases.items():
            decision = resolve_file_tool_permission(str(target), tool_name=name, allowlist=tool.allowlist,
                denylist=tool.denylist, config_permission=tool.permission, sensitive_patterns=tool.sensitive_patterns,
                workspace=workspace)
            permission = decision.permission if decision is not None else tool.permission
            expected_permission = ToolPermission.ALWAYS if label in ('root','immediate','nested','deep') else ToolPermission.NEVER
            assert permission == expected_permission, (name,label,permission,expected_permission)
            decisions[label] = permission.value
        result[name] = decisions
    print(json.dumps({'mode':mode,'enabled_tools':config.enabled_tools,'decisions':result}))

asyncio.run(main())
