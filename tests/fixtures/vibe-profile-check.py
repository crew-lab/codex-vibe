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
diagnostics = launcher.WorkerDiagnostics(str(Path(os.environ['VIBE_HOME']).parent))
launcher._patch_tool_diagnostics(None)
from vibe.core.agents.manager import AgentManager
from vibe.core.config.harness_files import HarnessFilesManager, init_harness_files_manager
from vibe.core.config.layers.default import DefaultConfigLayer
from vibe.core.config.layers.environment import EnvironmentLayer
from vibe.core.config.layers.agent_profile import AgentProfileLayer
from vibe.core.config.orchestrator import ConfigOrchestrator
from vibe.core.config.vibe_schema import VibeConfigSchema
from vibe.core.tools.base import BaseToolConfig
from vibe.core.tools.manager import ToolManager
from vibe.core.tools.permissions import ToolPermission
from vibe.core.tools.utils import resolve_file_tool_permission
from vibe.core.workspace import Workspace

async def main():
    assert vibe.__version__ == "2.26.1", "Wrong installed Vibe version"
    root = Path(sys.argv[1]).resolve()
    init_harness_files_manager('user', 'project')
    class Trusted:
        def is_trusted(self, path):
            return True
    harness = HarnessFilesManager(sources=('user', 'project'), cwd=root, trust_store=Trusted())
    # Include the cwd, nested roots and moved workspace to verify isolation holds.
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
    incomplete_manager = ToolManager(lambda: config, defer_mcp=True, cwd=root, harness_files=harness)
    del incomplete_manager._all_tools['read_file']
    try:
        incomplete_manager.available_tools
        raise AssertionError('Missing required effective tool did not fail closed')
    except RuntimeError as error:
        assert 'does not match the supervisor profile' in str(error)
    unexpected_manager = ToolManager(lambda: config, defer_mcp=True, cwd=root, harness_files=harness)
    unexpected_manager._all_tools['unexpected'] = unexpected_manager._all_tools['read_file']
    unexpected_config = config.model_copy(update={'enabled_tools': [*config.enabled_tools, 'unexpected']})
    unexpected_manager._config_getter = lambda: unexpected_config
    try:
        unexpected_manager.available_tools
        raise AssertionError('Unexpected effective tool did not fail closed')
    except RuntimeError as error:
        assert 'does not match the supervisor profile' in str(error)
    launcher._patch_tool_diagnostics(diagnostics)
    tool_manager = ToolManager(lambda: config, defer_mcp=True, cwd=root, harness_files=harness)
    effective = set(tool_manager.available_tools)
    assert effective == set(expected), f'Unexpected effective ToolManager inventory: {sorted(effective)}'
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
    # Exercise actual local read_file calls on ordinary and hidden YAML paths.
    # This calls no model/provider and records only fixed labels and tool names.
    read_tool = tool_manager.get('read_file')
    read_results = {}
    for label in ('ordinary', 'github_deploy', 'github_rollback'):
        target = {'ordinary': root/'ordinary.txt',
                  'github_deploy': root/'.github/workflows/deploy.yml',
                  'github_rollback': root/'.github/workflows/rollback.yml'}[label]
        args = read_tool.validate_arguments({'file_path': str(target)})
        decision = read_tool.resolve_permission(args)
        permission = decision.permission if decision is not None else read_tool.config.permission
        assert permission == ToolPermission.ALWAYS, (label, permission)
        chunks = [item async for item in read_tool.invoke(file_path=str(target))]
        result_value = next(item for item in chunks if hasattr(item, 'content'))
        assert label.split('_')[-1] in result_value.content if label != 'ordinary' else 'ordinary-marker' in result_value.content
        read_results[label] = {'tool': 'read_file', 'outcome': 'completed'}
    assert diagnostics.tool_inventory == sorted(expected), diagnostics.tool_inventory
    assert diagnostics.tool_calls == [item for _ in range(3) for item in (
        {'tool': 'read_file', 'outcome': 'attempt'},
        {'tool': 'read_file', 'outcome': 'completed'},
    )], diagnostics.tool_calls
    print(json.dumps({'mode':mode,'enabled_tools':config.enabled_tools,
                      'effective_tools':sorted(effective),'decisions':result,'read_results':read_results,
                      'diagnostic_tool_inventory':diagnostics.tool_inventory,
                      'diagnostic_tool_calls':diagnostics.tool_calls}))

asyncio.run(main())
