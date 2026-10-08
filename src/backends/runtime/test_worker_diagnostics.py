from __future__ import annotations
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
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

    def test_disabled_or_acp_does_not_capture_frames(self):
        for env in ({}, {LAUNCHER.DIAGNOSTICS_ENV: '1', 'VIBE_SUPERVISOR_ENTRYPOINT': 'acp'}):
            with patch.dict(os.environ, env, clear=True):
                self.assertIsNone(LAUNCHER._start_diagnostics())

if __name__ == '__main__':
    unittest.main()
