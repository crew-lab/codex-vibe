"""Offline bootstrap tests: no Vibe import, credential lookup, or inference."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("app_server_bootstrap", Path(__file__).with_name("app_server_bootstrap.py"))
BOOTSTRAP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BOOTSTRAP)


class AppServerBootstrapTests(unittest.TestCase):
    def test_hashes_source_without_importing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            module = root / "module.py"
            payload = b"raise AssertionError('must not execute')\n"
            module.write_bytes(payload)
            manifest = {"files": {"module.py": hashlib.sha256(payload).hexdigest()}}
            self.assertEqual(BOOTSTRAP.verify_manifest(root, manifest), 1)
            module.write_text("modified")
            with self.assertRaisesRegex(RuntimeError, "runtime-hash-mismatch"):
                BOOTSTRAP.verify_manifest(root, manifest)

    def test_refuses_symlinked_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "outside").write_bytes(b"source")
            (root / "module.py").symlink_to(root / "outside")
            manifest = {"files": {"module.py": hashlib.sha256(b"source").hexdigest()}}
            with self.assertRaises(OSError):
                BOOTSTRAP.verify_manifest(root, manifest)

    def test_refuses_manifest_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(RuntimeError, "unsafe-manifest-path"):
                BOOTSTRAP.verify_manifest(Path(directory).resolve(), {"files": {"../outside": "a" * 64}})

    def test_reuses_bounded_credential_lookup_with_only_fake_values(self):
        calls = []
        def runner(argv, env, timeout, limit):
            calls.append((argv, env, timeout, limit))
            return 0, b"fixture-only-value\n"
        with tempfile.TemporaryDirectory() as directory:
            env = {}
            self.assertEqual(BOOTSTRAP.resolve_credential(env, str(Path(directory).resolve()), runner=runner), "keychain")
            self.assertEqual(env, {"MISTRAL_API_KEY": "fixture-only-value"})
            self.assertEqual(calls[0][2:], (5.0, 8192))
            self.assertEqual(calls[0][1]["PATH"], "/usr/bin:/bin")

    def test_existing_environment_key_does_not_call_keychain(self):
        def unexpected(*args):
            self.fail("must not call Keychain")
        env = {"MISTRAL_API_KEY": "fixture-only-value"}
        self.assertEqual(BOOTSTRAP.resolve_credential(env, None, runner=unexpected), "environment")

    def test_watchdog_stops_its_own_worker_on_parent_loss_or_deadline(self):
        for parent, elapsed in [(99, 0), (1, 11)]:
            killed = []
            mono = [0]
            guard = BOOTSTRAP.WorkerWatchdog(
                parent_pid=1, timeout_seconds=10, hard_cap_seconds=10,
                wall_clock=lambda: 0, monotonic_clock=lambda: mono[0],
                get_parent_pid=lambda: parent, kill=lambda: killed.append(True),
            )
            mono[0] = elapsed
            self.assertTrue(guard.tick())
            self.assertEqual(killed, [True])


if __name__ == "__main__":
    unittest.main()
