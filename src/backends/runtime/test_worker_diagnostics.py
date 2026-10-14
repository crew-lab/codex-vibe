from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
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

    def test_inventory_and_call_limits_are_marked(self):
        self.recorder.record_tool_inventory(['read_file', 'grep'] * 65)
        for _ in range(LAUNCHER.TOOL_CALL_LIMIT + 1):
            self.recorder.record_tool_call('read_file', 'attempt')
        self.recorder.tick()
        report = self.data()
        self.assertFalse(report['tool_inventory_truncated'])
        self.assertTrue(report['tool_calls_truncated'])
        self.assertEqual(len(report['tool_calls']), LAUNCHER.TOOL_CALL_LIMIT)

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

if __name__ == '__main__':
    unittest.main()
