"""Vibe-free fail-closed and startup-order checks for project isolation."""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('project_launcher', Path(__file__).with_name('vibe_supervisor_launcher.py'))
LAUNCHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAUNCHER)
SOURCE = 'pinned fixture source'


class ProjectDiscoveryTest(unittest.TestCase):
    def setUp(self):
        class Manager:
            @property
            def project_source_enabled(self):
                return True

            @property
            def project_roots(self):
                return ['hostile-project']
        self.manager = Manager
        self.module = types.SimpleNamespace(HarnessFilesManager=Manager)
        self.addCleanup(patch.stopall)
        patch.object(LAUNCHER, 'PROJECT_DISCOVERY_SOURCE_SHA256', hashlib.sha256(SOURCE.encode()).hexdigest()).start()
        self.source = patch.object(LAUNCHER.inspect, 'getsource', return_value=SOURCE).start()

    def test_disables_all_instances_including_existing_ones(self):
        existing = self.manager()
        LAUNCHER._patch_project_discovery(self.module)
        for instance in [existing, self.manager()]:
            self.assertFalse(instance.project_source_enabled)
            self.assertEqual(instance.project_roots, [])

    def test_source_drift_refuses_before_mutating_properties(self):
        self.source.return_value += '\nchanged'
        with self.assertRaisesRegex(RuntimeError, 'source drift'):
            LAUNCHER._patch_project_discovery(self.module)
        self.assertTrue(self.manager().project_source_enabled)
        self.assertEqual(self.manager().project_roots, ['hostile-project'])

    def test_unavailable_source_fails_closed(self):
        self.source.side_effect = OSError('source missing')
        with self.assertRaisesRegex(RuntimeError, 'source unavailable'):
            LAUNCHER._patch_project_discovery(self.module)

    def test_signature_drift_refuses_before_partial_patch(self):
        self.manager.project_roots = property(lambda self, extra: [])
        with self.assertRaisesRegex(RuntimeError, 'property: project_roots'):
            LAUNCHER._patch_project_discovery(self.module)
        self.assertTrue(self.manager().project_source_enabled)

    def test_missing_property_fails_closed(self):
        del self.manager.project_roots
        with self.assertRaisesRegex(RuntimeError, 'property: project_roots'):
            LAUNCHER._patch_project_discovery(self.module)
        self.assertTrue(self.manager().project_source_enabled)


class StartupOrderTest(unittest.TestCase):
    def main_fixture(self, kind, discovery_error=None):
        events = []
        module_name = LAUNCHER.ENTRYPOINTS[kind]
        backend = types.SimpleNamespace(main=lambda: events.append('entrypoint'))
        def discovery():
            events.append('discovery')
            if discovery_error:
                raise discovery_error
        with patch.dict(sys.modules, {'vibe': types.SimpleNamespace(__version__=LAUNCHER.EXPECTED_VERSION)}), \
             patch.dict(LAUNCHER.os.environ, {'VIBE_SUPERVISOR_ENTRYPOINT':kind}, clear=True), \
             patch.object(LAUNCHER, '_start_parent_watchdog'), \
             patch.object(LAUNCHER, '_start_diagnostics', return_value=None), \
             patch.object(LAUNCHER, 'consume_prompt_file', side_effect=lambda env, argv, directory: argv), \
             patch.object(LAUNCHER, '_patch_project_discovery', side_effect=discovery), \
             patch.object(LAUNCHER, '_patch_session_logger', side_effect=lambda: events.append('logger')), \
             patch.object(LAUNCHER, 'resolve_credential', side_effect=lambda *args: events.append('credential') or 'environment'), \
             patch.object(LAUNCHER, '__import__', return_value=backend, create=True), \
             patch.object(sys, 'argv', ['shim.py']):
            if discovery_error:
                with self.assertRaisesRegex(RuntimeError, 'source drift'):
                    LAUNCHER.main()
            else:
                LAUNCHER.main()
        return events

    def test_both_entrypoints_disable_discovery_before_credentials_and_backend(self):
        for kind in LAUNCHER.ENTRYPOINTS:
            with self.subTest(kind=kind):
                self.assertEqual(self.main_fixture(kind), ['discovery','logger','credential','entrypoint'])

    def test_drift_starts_neither_credentials_nor_backend(self):
        for kind in LAUNCHER.ENTRYPOINTS:
            with self.subTest(kind=kind):
                self.assertEqual(self.main_fixture(kind, RuntimeError('source drift')), ['discovery'])
