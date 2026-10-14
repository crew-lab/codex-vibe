from __future__ import annotations
import asyncio
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('vibe_supervisor_launcher_diagnostics', HERE / 'vibe_supervisor_launcher.py')
assert SPEC and SPEC.loader
LAUNCHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAUNCHER)

class DiagnosticsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='vibe-diagnostics-')
        self.addCleanup(self.temp.cleanup)
        self.directory = os.path.realpath(self.temp.name)
        self.now = 0.0
        self.recorder = LAUNCHER.WorkerDiagnostics(self.directory, lambda: self.now)
        self.addCleanup(self.recorder.close)
        self.file = Path(self.directory) / LAUNCHER.DIAGNOSTICS_FILE

    def data(self):
        return json.loads(self.file.read_text())

    def test_stages_are_fixed_once_and_owner_only(self):
        self.recorder.stage('launch')
        self.now = 0.125
        self.recorder.stage('import')
        self.recorder.stage('import')
        self.recorder.stage('untrusted canary')
        self.recorder.tick()
        self.assertEqual(self.data()['stages'], [{'stage': 'launch', 'elapsed_ms': 0}, {'stage': 'import', 'elapsed_ms': 125}])
        self.assertEqual(self.file.stat().st_mode & 0o777, 0o600)

    def test_snapshot_timing_and_three_snapshot_cap(self):
        for value, expected in [(59, 0), (60, 1), (179, 1), (180, 2), (599, 2), (600, 3), (1000, 3)]:
            self.now = value
            self.recorder.tick()
            self.assertEqual(len(self.data()['snapshots']), expected)
        self.assertLessEqual(self.file.stat().st_size, 65536)

    def test_frames_never_include_locals_arguments_or_source(self):
        secret_canary = 'LOCAL-SECRET-CANARY-DO-NOT-SAVE'
        prompt_canary = 'PRIVATE-PROMPT-CANARY-DO-NOT-SAVE'
        self.recorder.frames = lambda: {1: sys._getframe()}
        self.now = 60
        self.recorder.tick()
        text = self.file.read_text()
        self.assertNotIn(secret_canary, text)
        self.assertNotIn(prompt_canary, text)
        for thread in self.data()['snapshots'][0]['threads']:
            for frame in thread:
                self.assertEqual(set(frame), {'file', 'function', 'line'})
                self.assertFalse(frame['file'].startswith('/'))

    def test_known_secret_in_code_metadata_is_filtered(self):
        secret = 'fixture_secret_canary'
        with patch.dict(os.environ, {'MISTRAL_API_KEY': secret}):
            frame = type('Frame', (), {'f_code': type('Code', (), {'co_filename': str(HERE / 'vibe_supervisor_launcher.py'), 'co_name': secret})(), 'f_lineno': 5, 'f_back': None})()
            self.recorder.frames = lambda: {1: frame}
            self.now = 60
            self.recorder.tick()
            self.assertNotIn(secret, self.file.read_text())

    def test_snapshot_size_bounds_many_large_frames(self):
        frame = type('Frame', (), {'f_code': type('Code', (), {'co_filename': str(HERE / 'vibe_supervisor_launcher.py'), 'co_name': 'f' * 96})(), 'f_lineno': 100, 'f_back': None})()
        frame.f_back = frame
        self.recorder.frames = lambda: {i: frame for i in range(100)}
        for value in (60, 180, 600):
            self.now = value
            self.recorder.tick()
        self.assertLessEqual(self.file.stat().st_size, 65536)
        self.assertEqual(len(self.data()['snapshots']), 3)

    def test_existing_regular_file_is_preserved(self):
        self.file.write_text('preserve')
        self.recorder.tick()
        self.assertTrue(self.recorder.disabled)
        self.assertEqual(self.file.read_text(), 'preserve')

    def test_symlink_and_existing_files_are_not_overwritten(self):
        target = Path(self.directory) / 'existing'
        target.write_text('preserve')
        self.file.symlink_to(target)
        self.recorder.tick()
        self.assertTrue(self.recorder.disabled)
        self.assertEqual(target.read_text(), 'preserve')

    def test_unsafe_directories_disable_diagnostics(self):
        for directory in ('relative', self.directory):
            os.chmod(self.directory, 0o755)
            recorder = LAUNCHER.WorkerDiagnostics(directory, lambda: 0)
            recorder.tick()
            self.assertTrue(recorder.disabled)
            recorder.close()
        os.chmod(self.directory, 0o700)

    def test_write_failure_does_not_escape_or_leave_descriptor(self):
        with patch.object(LAUNCHER.os, 'write', side_effect=OSError('fixture write failure')):
            self.recorder.tick()
        self.assertTrue(self.recorder.disabled)
        self.assertIsNone(self.recorder.descriptor)
        self.recorder.stage('import')
        self.recorder.tick()

    def test_disabled_does_not_capture_frames(self):
        for env in ({},):
            with patch.dict(os.environ, env, clear=True):
                self.assertIsNone(LAUNCHER._start_diagnostics())

    def test_enabled_start_creates_owner_only_metadata_recorder(self):
        class ThreadStub:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
            def start(self):
                pass
        with patch.dict(os.environ, {LAUNCHER.DIAGNOSTICS_ENV: '1'}), \
             patch.object(LAUNCHER, '__file__', str(Path(self.directory) / 'vibe_supervisor_launcher.py')), \
             patch.object(LAUNCHER.threading, 'Thread', ThreadStub):
            recorder = LAUNCHER._start_diagnostics()
        self.assertNotIn(LAUNCHER.DIAGNOSTICS_ENV, os.environ)
        self.assertIsNotNone(recorder)
        recorder.tick()
        self.assertEqual(self.data()['stages'], [{'stage': 'launch', 'elapsed_ms': 0}])
        self.assertEqual(self.data()['tool_inventory'], [])
        self.assertEqual(self.data()['tool_calls'], [])
        self.assertEqual(self.file.stat().st_mode & 0o777, 0o600)

    def test_tool_metadata_is_name_and_outcome_only_and_bounded(self):
        self.recorder.record_tool_inventory(['read_file', 'grep', '../outside', 'provider_secret'])
        self.recorder.record_tool_call('read_file', 'attempt')
        self.recorder.record_tool_call('read_file', 'completed')
        self.recorder.record_tool_call('bad/name', 'failed')
        self.recorder.record_tool_call('read_file', 'permission-denied')
        self.recorder.tick()
        self.assertEqual(self.data()['tool_inventory'], ['<other>', 'grep', 'read_file'])
        self.assertEqual(self.data()['tool_calls'], [
            {'tool': 'read_file', 'outcome': 'attempt'},
            {'tool': 'read_file', 'outcome': 'completed'},
            {'tool': '<other>', 'outcome': 'failed'},
        ])

    def test_call_limit_is_marked_and_inventory_has_no_cap(self):
        self.recorder.record_tool_inventory(['read_file', 'grep'] * 65)
        for _ in range(LAUNCHER.TOOL_CALL_LIMIT + 1):
            self.recorder.record_tool_call('read_file', 'attempt')
        self.recorder.tick()
        report = self.data()
        self.assertNotIn('tool_inventory_truncated', report)
        self.assertEqual(report['tool_inventory'], ['grep', 'read_file'])
        self.assertTrue(report['tool_calls_truncated'])
        self.assertEqual(len(report['tool_calls']), LAUNCHER.TOOL_CALL_LIMIT)

    def test_refused_and_cancelled_outcomes_are_recorded(self):
        self.recorder.record_tool_call('bash', 'refused')
        self.recorder.record_tool_call('read_file', 'cancelled')
        self.recorder.record_tool_call('read_file', 'unknown-outcome')
        self.recorder.tick()
        self.assertEqual(self.data()['tool_calls'], [
            {'tool': '<other>', 'outcome': 'refused'},
            {'tool': 'read_file', 'outcome': 'cancelled'},
        ])

    def test_final_flush_preserves_short_run_tool_outcomes(self):
        self.recorder.record_tool_inventory(['read_file', 'grep'])
        self.recorder.record_tool_call('read_file', 'attempt')
        self.recorder.record_tool_call('read_file', 'completed')
        LAUNCHER._finish_diagnostics(self.recorder)
        report = self.data()
        self.assertEqual(report['tool_calls'], [
            {'tool': 'read_file', 'outcome': 'attempt'},
            {'tool': 'read_file', 'outcome': 'completed'},
        ])
        self.assertEqual(report['tool_inventory'], ['grep', 'read_file'])
        self.assertIsNone(self.recorder.descriptor)

    def test_monitor_tick_and_final_flush_serialize_descriptor_lifecycle(self):
        self.recorder.record_tool_inventory(['read_file'])
        self.recorder.record_tool_call('read_file', 'attempt')
        errors = []
        monitor = threading.Thread(target=lambda: self._capture(errors, self.recorder.tick))
        monitor.start()
        self._capture(errors, lambda: LAUNCHER._finish_diagnostics(self.recorder))
        monitor.join(timeout=2)
        self.assertFalse(monitor.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(self.data()['tool_calls'], [{'tool': 'read_file', 'outcome': 'attempt'}])
        self.assertIsNone(self.recorder.descriptor)

    @staticmethod
    def _capture(errors, callback):
        try:
            callback()
        except Exception as error:
            errors.append(error)

PINNED_SOURCE_CONSTANTS = (
    'TOOL_INVOKE_SOURCE_SHA256',
    'TOOL_INVENTORY_SOURCE_SHA256',
    'TOOL_SCHEMA_SOURCE_SHA256',
    'TOOL_CALL_RESOLUTION_SOURCE_SHA256',
    'TOOL_LOOKUP_SOURCE_SHA256',
)


def build_stub_vibe():
    calls = []

    class BaseTool:
        behavior = 'complete'

        def get_name(self):
            return self.name

        async def invoke(self, ctx=None, **raw):
            calls.append(raw)
            if self.behavior == 'hang':
                await asyncio.Event().wait()
            if self.behavior == 'fail':
                raise ValueError('stub failure')
            yield 'first'
            yield 'second'

    class ToolManager:
        def __init__(self, tools):
            self.tools = tools

        @property
        def available_tools(self):
            return self.tools

        def get(self, tool_name):
            return self.tools[tool_name]

    class APIToolFormatHandler:
        def get_available_tools(self, tool_manager, config):
            return list(tool_manager.available_tools)

        def resolve_tool_calls(self, message, tool_manager, config):
            return []

    def named_tool(name, behavior='complete'):
        return type('Tool_' + name, (BaseTool,), {'name': name, 'behavior': behavior})()

    modules = {
        'vibe.core.llm.format': types.SimpleNamespace(APIToolFormatHandler=APIToolFormatHandler),
        'vibe.core.tools.base': types.SimpleNamespace(BaseTool=BaseTool),
        'vibe.core.tools.manager': types.SimpleNamespace(ToolManager=ToolManager),
    }
    return types.SimpleNamespace(
        calls=calls, BaseTool=BaseTool, ToolManager=ToolManager, APIToolFormatHandler=APIToolFormatHandler,
        named_tool=named_tool, modules=modules)


def source_sha256(member):
    return hashlib.sha256(inspect.getsource(member).encode('utf-8')).hexdigest()


class ToolProfileTest(unittest.TestCase):
    def setUp(self):
        self.vibe = build_stub_vibe()
        self.activate(patch.dict(sys.modules, self.vibe.modules))
        self.pins = {
            'TOOL_INVOKE_SOURCE_SHA256': source_sha256(self.vibe.BaseTool.invoke),
            'TOOL_INVENTORY_SOURCE_SHA256': source_sha256(self.vibe.ToolManager.available_tools.fget),
            'TOOL_SCHEMA_SOURCE_SHA256': source_sha256(self.vibe.APIToolFormatHandler.get_available_tools),
            'TOOL_CALL_RESOLUTION_SOURCE_SHA256': source_sha256(self.vibe.APIToolFormatHandler.resolve_tool_calls),
            'TOOL_LOOKUP_SOURCE_SHA256': source_sha256(self.vibe.ToolManager.get),
        }
        for name, value in self.pins.items():
            self.activate(patch.object(LAUNCHER, name, value))
        self.activate(patch.dict(os.environ, {
            'VIBE_DEFAULT_AGENT': 'plan',
            'VIBE_ENABLED_TOOLS': json.dumps(['read_file', 'grep']),
        }))
        self.temp = tempfile.TemporaryDirectory(prefix='vibe-tool-profile-')
        self.addCleanup(self.temp.cleanup)
        self.recorder = LAUNCHER.WorkerDiagnostics(os.path.realpath(self.temp.name))
        self.addCleanup(self.recorder.close)

    def activate(self, manager):
        value = manager.__enter__()
        self.addCleanup(manager.__exit__, None, None, None)
        return value

    @staticmethod
    def collect(tool):
        async def run():
            return [item async for item in tool.invoke(path='fixture')]
        return asyncio.run(run())

    def test_tool_outside_the_profile_never_reaches_the_original_invoke(self):
        LAUNCHER._patch_tool_diagnostics(self.recorder)
        with self.assertRaisesRegex(LAUNCHER.ToolOutsideProfileError, 'Tool bash is outside the supervisor tool profile'):
            self.collect(self.vibe.named_tool('bash'))
        self.assertEqual(self.vibe.calls, [])
        self.assertEqual(self.recorder.tool_calls, [{'tool': '<other>', 'outcome': 'refused'}])

    def test_review_profile_refuses_edit_tools(self):
        LAUNCHER._patch_tool_diagnostics(None)
        for name in ('write_file', 'edit'):
            with self.assertRaises(PermissionError):
                self.collect(self.vibe.named_tool(name))
        self.assertEqual(self.vibe.calls, [])

    def test_refusal_holds_without_diagnostics(self):
        LAUNCHER._patch_tool_diagnostics(None)
        with self.assertRaises(LAUNCHER.ToolOutsideProfileError):
            self.collect(self.vibe.named_tool('bash'))
        self.assertEqual(self.vibe.calls, [])

    def test_refusal_message_does_not_echo_unsafe_names(self):
        LAUNCHER._patch_tool_diagnostics(None)
        with self.assertRaisesRegex(LAUNCHER.ToolOutsideProfileError, r'Tool <other> is outside'):
            self.collect(self.vibe.named_tool('../secret path'))

    def test_edit_profile_allows_edit_tools(self):
        with patch.dict(os.environ, {'VIBE_DEFAULT_AGENT': 'accept-edits',
                                     'VIBE_ENABLED_TOOLS': json.dumps(['read_file', 'grep', 'write_file', 'edit'])}):
            LAUNCHER._patch_tool_diagnostics(None)
        self.assertEqual(self.collect(self.vibe.named_tool('edit')), ['first', 'second'])

    def test_allowed_tool_runs_and_is_recorded_with_diagnostics(self):
        LAUNCHER._patch_tool_diagnostics(self.recorder)
        self.assertEqual(self.collect(self.vibe.named_tool('read_file')), ['first', 'second'])
        self.assertEqual(self.vibe.calls, [{'path': 'fixture'}])
        self.assertEqual(self.recorder.tool_calls, [
            {'tool': 'read_file', 'outcome': 'attempt'},
            {'tool': 'read_file', 'outcome': 'completed'},
        ])

    def test_allowed_tool_runs_without_diagnostics(self):
        LAUNCHER._patch_tool_diagnostics(None)
        self.assertEqual(self.collect(self.vibe.named_tool('grep')), ['first', 'second'])
        self.assertEqual(self.vibe.calls, [{'path': 'fixture'}])

    def test_failed_tool_is_recorded_and_reraised(self):
        LAUNCHER._patch_tool_diagnostics(self.recorder)
        with self.assertRaises(ValueError):
            self.collect(self.vibe.named_tool('read_file', 'fail'))
        self.assertEqual(self.recorder.tool_calls, [
            {'tool': 'read_file', 'outcome': 'attempt'},
            {'tool': 'read_file', 'outcome': 'failed'},
        ])

    def test_cancelled_call_is_recorded_and_reraised(self):
        LAUNCHER._patch_tool_diagnostics(self.recorder)
        tool = self.vibe.named_tool('read_file', 'hang')

        async def scenario():
            async def drain():
                return [item async for item in tool.invoke(path='fixture')]
            task = asyncio.ensure_future(drain())
            while not self.vibe.calls:
                await asyncio.sleep(0)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task

        asyncio.run(scenario())
        self.assertEqual(self.recorder.tool_calls, [
            {'tool': 'read_file', 'outcome': 'attempt'},
            {'tool': 'read_file', 'outcome': 'cancelled'},
        ])

    def test_closed_generator_is_recorded_as_cancelled(self):
        LAUNCHER._patch_tool_diagnostics(self.recorder)
        tool = self.vibe.named_tool('read_file')

        async def scenario():
            generator = tool.invoke(path='fixture')
            self.assertEqual(await generator.__anext__(), 'first')
            await generator.aclose()

        asyncio.run(scenario())
        self.assertEqual(self.recorder.tool_calls, [
            {'tool': 'read_file', 'outcome': 'attempt'},
            {'tool': 'read_file', 'outcome': 'cancelled'},
        ])

    def test_inventory_mismatch_still_fails_closed(self):
        LAUNCHER._patch_tool_diagnostics(self.recorder)
        complete = self.vibe.ToolManager({'read_file': object(), 'grep': object()})
        self.assertEqual(set(complete.available_tools), {'read_file', 'grep'})
        self.assertEqual(self.recorder.tool_inventory, ['grep', 'read_file'])
        for tools in ({'read_file': object()}, {'read_file': object(), 'grep': object(), 'bash': object()}):
            with self.assertRaisesRegex(RuntimeError, 'does not match the supervisor profile'):
                self.vibe.ToolManager(tools).available_tools

    def test_pin_drift_raises_before_anything_is_patched(self):
        original_invoke = self.vibe.BaseTool.invoke
        original_inventory = self.vibe.ToolManager.__dict__['available_tools']
        for constant in PINNED_SOURCE_CONSTANTS:
            with self.subTest(constant=constant), patch.object(LAUNCHER, constant, '0' * 64):
                with self.assertRaisesRegex(RuntimeError, 'refusing tool profile'):
                    LAUNCHER._patch_tool_diagnostics(None)
                self.assertIs(self.vibe.BaseTool.invoke, original_invoke)
                self.assertIs(self.vibe.ToolManager.__dict__['available_tools'], original_inventory)
                self.assertFalse(hasattr(self.vibe.BaseTool, '_vibe_supervisor_original_invoke'))
                self.assertFalse(hasattr(self.vibe.ToolManager, '_vibe_supervisor_original_available_tools'))

    def test_unsupported_agent_or_tool_profile_raises(self):
        for env in ({'VIBE_DEFAULT_AGENT': 'default'}, {'VIBE_ENABLED_TOOLS': json.dumps(['read_file', 'grep', 'bash'])},
                    {'VIBE_ENABLED_TOOLS': 'not json'}):
            with self.subTest(env=env), patch.dict(os.environ, env):
                with self.assertRaises(RuntimeError):
                    LAUNCHER._patch_tool_diagnostics(None)

    def test_source_unavailable_raises(self):
        with patch.object(LAUNCHER.inspect, 'getsource', side_effect=OSError('no source')):
            with self.assertRaisesRegex(RuntimeError, 'source unavailable'):
                LAUNCHER._patch_tool_diagnostics(None)


class SkillProfileTest(unittest.TestCase):
    def test_every_skill_disabled_and_none_enabled_passes(self):
        LAUNCHER._assert_skills_disabled({'VIBE_DISABLED_SKILLS': '["*"]'})

    def test_missing_or_wrong_disabled_skills_raises(self):
        for value in (None, '', 'not json', '[]', '["vibe"]', '["*", "vibe"]', '"*"', '*', '{"*": true}'):
            with self.subTest(value=value):
                environ = {} if value is None else {'VIBE_DISABLED_SKILLS': value}
                with self.assertRaises(RuntimeError):
                    LAUNCHER._assert_skills_disabled(environ)

    def test_enabled_skills_raises(self):
        for value in ('', '[]', '["vibe"]', '["*"]', 'vibe', '{}'):
            with self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    LAUNCHER._assert_skills_disabled({'VIBE_DISABLED_SKILLS': '["*"]', 'VIBE_ENABLED_SKILLS': value})


if __name__ == '__main__':
    unittest.main()
