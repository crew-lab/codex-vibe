"""Vibe-free tests for the shim's Keychain credential lookup. Uses only mocked or fake `security` programs."""
from __future__ import annotations

import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("vibe_supervisor_launcher", HERE / "vibe_supervisor_launcher.py")
assert SPEC and SPEC.loader
LAUNCHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAUNCHER)

CANARY = "keychain-canary-value-7f3a91"
KEY = LAUNCHER.CREDENTIAL_ENV
ORIGINAL_HOME = LAUNCHER.ORIGINAL_HOME_ENV


class Recorder:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def __call__(self, argv, env, timeout, limit):
        self.calls.append((list(argv), dict(env), timeout, limit))
        result = self.results.pop(0) if len(self.results) > 1 else self.results[0]
        if isinstance(result, BaseException):
            raise result
        return result


class HomeCase(unittest.TestCase):
    def setUp(self) -> None:
        temp = tempfile.TemporaryDirectory(prefix="vibe-keychain-fixture-")
        self.addCleanup(temp.cleanup)
        self.root = os.path.realpath(temp.name)
        self.home = os.path.join(self.root, "original-home")
        os.mkdir(self.home)


class LookupTest(HomeCase):
    def lookup(self, results):
        recorder = Recorder(results)
        return LAUNCHER.lookup_keychain_credential(self.home, recorder), recorder

    def test_success_strips_exactly_one_trailing_newline(self) -> None:
        (value, reason), _ = self.lookup([(0, CANARY.encode() + b"\n")])
        self.assertEqual((value, reason), (CANARY, "found"))
        (value, _), _ = self.lookup([(0, CANARY.encode() + b"\n\n")])
        self.assertIsNone(value)
        (value, _), _ = self.lookup([(0, CANARY.encode())])
        self.assertEqual(value, CANARY)

    def test_exact_argv_and_minimal_environment(self) -> None:
        _, recorder = self.lookup([(0, CANARY.encode() + b"\n")])
        argv, env, timeout, limit = recorder.calls[0]
        self.assertEqual(argv, ["/usr/bin/security", "find-generic-password", "-a", "MISTRAL_API_KEY", "-s", "ai.mistral.vibe", "-w"])
        self.assertEqual(env, {"HOME": self.home, "PATH": "/usr/bin:/bin"})
        self.assertEqual(timeout, 5.0)
        self.assertEqual(limit, 8 * 1024)

    def test_legacy_service_is_tried_only_after_the_primary_misses(self) -> None:
        (value, _), recorder = self.lookup([(44, b""), (0, b"legacy-value-1234\n")])
        self.assertEqual(value, "legacy-value-1234")
        self.assertEqual([call[0][5] for call in recorder.calls], ["ai.mistral.vibe", "vibe"])

    def test_missing_item_returns_nothing(self) -> None:
        (value, reason), recorder = self.lookup([(44, b"")])
        self.assertEqual((value, reason), (None, "not-found"))
        self.assertEqual(len(recorder.calls), 2)

    def test_output_on_failure_exit_is_ignored(self) -> None:
        (value, _), _ = self.lookup([(1, CANARY.encode() + b"\n")])
        self.assertIsNone(value)

    def test_invalid_outputs_return_nothing(self) -> None:
        for output in (b"\xff\xfe\x80bad\n", b"", b"\n", b"line one\nline two\n", b"abc\0def\n", b"abc\r\n"):
            (value, reason), _ = self.lookup([(0, output)])
            self.assertIsNone(value, output)
            self.assertEqual(reason, "invalid-output")

    def test_timeout_overflow_and_errors_return_nothing(self) -> None:
        for error, expected in ((TimeoutError(), "timeout"), (OverflowError(), "oversize"), (OSError("boom"), "error")):
            (value, reason), _ = self.lookup([error])
            self.assertEqual((value, reason), (None, expected))


class FakeSecurityTest(HomeCase):
    def script(self, body: str) -> str:
        path = os.path.join(self.root, "fake-security")
        Path(path).write_text("#!/bin/sh\n" + body)
        os.chmod(path, 0o755)
        return path

    def test_real_runner_passes_argv_and_minimal_env_to_a_fake_security(self) -> None:
        record = os.path.join(self.root, "record.txt")
        fake = self.script(f'printf "%s\\n" "$@" > {record}\nenv >> {record}\nprintf "{CANARY}\\n"\n')
        with mock.patch.dict(os.environ, {"VIBE_HOME": "/private/vibe", KEY: "ambient"}):
            value, reason = LAUNCHER.lookup_keychain_credential(self.home, executable=fake)
        self.assertEqual((value, reason), (CANARY, "found"))
        lines = Path(record).read_text().splitlines()
        self.assertEqual(lines[:6], ["find-generic-password", "-a", "MISTRAL_API_KEY", "-s", "ai.mistral.vibe", "-w"])
        env = dict(line.split("=", 1) for line in lines[6:] if "=" in line)
        self.assertEqual(env.get("HOME"), self.home)
        self.assertEqual(env.get("PATH"), "/usr/bin:/bin")
        self.assertNotIn("VIBE_HOME", env)
        self.assertNotIn(KEY, env)

    def test_real_runner_nonzero_exit_and_stderr_are_discarded(self) -> None:
        fake = self.script(f'echo "{CANARY}" >&2\nexit 44\n')
        self.assertEqual(LAUNCHER.lookup_keychain_credential(self.home, executable=fake), (None, "not-found"))

    def test_real_runner_times_out_and_kills_the_process(self) -> None:
        fake = self.script("exec sleep 30\n")
        with mock.patch.object(LAUNCHER, "KEYCHAIN_TIMEOUT_SECONDS", 0.3), mock.patch.object(LAUNCHER, "KEYCHAIN_SERVICES", ("only",)):
            started = LAUNCHER.time.monotonic()
            self.assertEqual(LAUNCHER.lookup_keychain_credential(self.home, executable=fake), (None, "timeout"))
            self.assertLess(LAUNCHER.time.monotonic() - started, 5)

    def test_real_runner_rejects_oversized_output(self) -> None:
        fake = self.script("head -c 20000 /dev/zero | tr '\\0' 'a'\n")
        with mock.patch.object(LAUNCHER, "KEYCHAIN_SERVICES", ("only",)):
            self.assertEqual(LAUNCHER.lookup_keychain_credential(self.home, executable=fake), (None, "oversize"))

    def test_real_runner_missing_executable_returns_nothing(self) -> None:
        with mock.patch.object(LAUNCHER, "KEYCHAIN_SERVICES", ("only",)):
            self.assertEqual(LAUNCHER.lookup_keychain_credential(self.home, executable=os.path.join(self.root, "absent")), (None, "error"))


class OriginalHomeTest(HomeCase):
    def test_accepts_an_owned_real_directory(self) -> None:
        self.assertEqual(LAUNCHER.trusted_original_home(self.home), self.home)

    def test_rejects_untrusted_values(self) -> None:
        link = os.path.join(self.root, "link")
        os.symlink(self.home, link)
        file_path = os.path.join(self.root, "file")
        Path(file_path).write_text("x")
        for value in (None, "", "relative/home", link, file_path, os.path.join(self.root, "missing"), self.home + "/../original-home", self.home + "\0x"):
            self.assertIsNone(LAUNCHER.trusted_original_home(value), value)

    def test_rejects_a_directory_owned_by_someone_else(self) -> None:
        with mock.patch.object(LAUNCHER.os, "getuid", return_value=os.getuid() + 1):
            self.assertIsNone(LAUNCHER.trusted_original_home(self.home))


class ResolveCredentialTest(HomeCase):
    def resolve(self, environ, original_home="default", platform="darwin", results=((0, CANARY.encode() + b"\n"),)):
        recorder = Recorder(results)
        home = self.home if original_home == "default" else original_home
        return LAUNCHER.resolve_credential(environ, home, platform, recorder), recorder

    def test_lookup_result_is_placed_only_in_the_given_environment(self) -> None:
        environ = {"HOME": "/private/child", "KEEP": "1"}
        status, recorder = self.resolve(environ)
        self.assertEqual(status, "keychain")
        self.assertEqual(environ, {"HOME": "/private/child", "KEEP": "1", KEY: CANARY})
        self.assertEqual(len(recorder.calls), 1)
        self.assertNotIn(KEY, recorder.calls[0][1])
        self.assertNotIn("/private/child", recorder.calls[0][1].values())

    def test_explicit_nonempty_environment_credential_wins_without_lookup(self) -> None:
        environ = {KEY: "explicit-value"}
        status, recorder = self.resolve(environ)
        self.assertEqual(status, "environment")
        self.assertEqual(environ, {KEY: "explicit-value"})
        self.assertEqual(recorder.calls, [])

    def test_empty_environment_value_is_treated_as_absent(self) -> None:
        environ = {KEY: ""}
        status, recorder = self.resolve(environ)
        self.assertEqual(status, "keychain")
        self.assertEqual(environ[KEY], CANARY)
        self.assertEqual(len(recorder.calls), 1)

    def test_empty_environment_value_is_removed_when_lookup_fails(self) -> None:
        environ = {KEY: "", "KEEP": "1"}
        status, _ = self.resolve(environ, results=((44, b""),))
        self.assertEqual(status, "not-found")
        self.assertEqual(environ, {"KEEP": "1"})

    def test_invalid_original_home_skips_the_lookup(self) -> None:
        for value in (None, "relative", os.path.join(self.root, "missing")):
            environ = {}
            status, recorder = self.resolve(environ, original_home=value)
            self.assertEqual(status, "skipped-home")
            self.assertEqual((environ, recorder.calls), ({}, []))

    def test_other_platforms_skip_the_lookup(self) -> None:
        environ = {}
        status, recorder = self.resolve(environ, platform="linux")
        self.assertEqual((status, environ, recorder.calls), ("skipped-platform", {}, []))


class MainTest(HomeCase):
    def run_main(self, version, environ, runner, validate_error=None):
        entry = mock.Mock()
        real_resolve = LAUNCHER.resolve_credential
        outcome = None
        with mock.patch.dict(os.environ, environ, clear=True), \
                mock.patch.dict(sys.modules, {"vibe": mock.Mock(__version__=version)}), \
                mock.patch.object(LAUNCHER, "_start_parent_watchdog"), \
                mock.patch.object(LAUNCHER, "_patch_session_logger", side_effect=validate_error), \
                mock.patch.object(LAUNCHER, "__import__", create=True, return_value=entry), \
                mock.patch.object(LAUNCHER, "resolve_credential", side_effect=lambda env, home: real_resolve(env, home, "darwin", runner)), \
                mock.patch.object(sys, "argv", ["shim.py"]):
            try:
                LAUNCHER.main()
                outcome = dict(os.environ)
            except (SystemExit, RuntimeError) as exc:
                outcome = exc
        return outcome, entry

    def environ(self, **extra):
        return {"VIBE_SUPERVISOR_ENTRYPOINT": "acp", ORIGINAL_HOME: self.home, **extra}

    def test_unsupported_version_is_rejected_before_any_lookup(self) -> None:
        runner = Recorder([(0, CANARY.encode() + b"\n")])
        outcome, entry = self.run_main("9.9.9", self.environ(), runner)
        self.assertIsInstance(outcome, SystemExit)
        self.assertEqual(runner.calls, [])
        entry.main.assert_not_called()

    def test_unknown_entrypoint_is_rejected_before_any_lookup(self) -> None:
        runner = Recorder([(0, CANARY.encode() + b"\n")])
        outcome, _ = self.run_main(LAUNCHER.EXPECTED_VERSION, self.environ(VIBE_SUPERVISOR_ENTRYPOINT="bogus"), runner)
        self.assertIsInstance(outcome, SystemExit)
        self.assertEqual(runner.calls, [])

    def test_failed_signature_validation_precedes_lookup(self) -> None:
        runner = Recorder([(0, CANARY.encode() + b"\n")])
        outcome, _ = self.run_main(LAUNCHER.EXPECTED_VERSION, self.environ(), runner, validate_error=RuntimeError("signature drift"))
        self.assertIsInstance(outcome, RuntimeError)
        self.assertEqual(runner.calls, [])

    def test_original_home_is_gone_and_other_environment_untouched_when_vibe_starts(self) -> None:
        runner = Recorder([(0, CANARY.encode() + b"\n")])
        stderr = io.StringIO()
        with mock.patch.object(sys, "stderr", stderr):
            outcome, entry = self.run_main(LAUNCHER.EXPECTED_VERSION, self.environ(HOME="/private/child", VIBE_HOME="/private/vibe", OTHER="kept"), runner)
            print(f"vibe failed with {CANARY}", file=sys.stderr)
            sys.stderr.flush(final=True)
        entry.main.assert_called_once()
        self.assertNotIn(ORIGINAL_HOME, outcome)
        self.assertEqual({k: outcome[k] for k in ("HOME", "VIBE_HOME", "OTHER")}, {"HOME": "/private/child", "VIBE_HOME": "/private/vibe", "OTHER": "kept"})
        self.assertEqual(outcome[KEY], CANARY)
        self.assertEqual(runner.calls[0][1], {"HOME": self.home, "PATH": "/usr/bin:/bin"})
        self.assertNotIn(CANARY, stderr.getvalue())
        self.assertIn("[REDACTED]", stderr.getvalue())

    def test_failed_lookup_still_starts_vibe_with_a_value_free_diagnostic(self) -> None:
        runner = Recorder([(44, CANARY.encode())])
        stderr = io.StringIO()
        with mock.patch.object(sys, "stderr", stderr):
            outcome, entry = self.run_main(LAUNCHER.EXPECTED_VERSION, self.environ(), runner)
        entry.main.assert_called_once()
        self.assertNotIn(KEY, outcome)
        self.assertNotIn(ORIGINAL_HOME, outcome)
        self.assertIn("not-found", stderr.getvalue())
        self.assertNotIn(CANARY, stderr.getvalue())

    def test_explicit_credential_skips_lookup_and_diagnostic(self) -> None:
        runner = Recorder([(0, CANARY.encode() + b"\n")])
        stderr = io.StringIO()
        with mock.patch.object(sys, "stderr", stderr):
            outcome, _ = self.run_main(LAUNCHER.EXPECTED_VERSION, self.environ(**{KEY: "explicit-value"}), runner)
        self.assertEqual(outcome[KEY], "explicit-value")
        self.assertEqual((runner.calls, stderr.getvalue()), ([], ""))
        self.assertNotIn(ORIGINAL_HOME, outcome)


class RedactingStreamTest(unittest.TestCase):
    def test_exact_value_is_replaced_including_across_writes_and_flush(self) -> None:
        sink = io.StringIO()
        stream = LAUNCHER.RedactingStream(sink, CANARY)
        stream.write(f"error with {CANARY} in line\n")
        stream.write(CANARY[:10])
        stream.flush()
        stream.write(CANARY[10:] + " tail\n")
        stream.write("partial " + CANARY)
        stream.flush(final=True)
        output = sink.getvalue()
        self.assertNotIn(CANARY, output)
        self.assertEqual(output.count("[REDACTED]"), 3)
        self.assertIn("tail\n", output)

    def test_delegates_stream_attributes(self) -> None:
        self.assertFalse(LAUNCHER.RedactingStream(io.StringIO(), CANARY).isatty())


if __name__ == "__main__":
    unittest.main()
