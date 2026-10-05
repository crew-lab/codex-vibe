"""Vibe-free tests for the shim's prompt file handoff."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("vibe_supervisor_launcher", HERE / "vibe_supervisor_launcher.py")
assert SPEC and SPEC.loader
LAUNCHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAUNCHER)
ENV = LAUNCHER.PROMPT_FILE_ENV


class ConsumePromptFileTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory(prefix="vibe-prompt-fixture-")
        self.addCleanup(self._temp.cleanup)
        self.run_dir = os.path.realpath(self._temp.name)
        self.argv = ["shim.py", "--agent", "plan", "--max-turns", "3"]

    def write(self, content: bytes = b"review the auth module\n\xe2\x9c\x93", mode: int = 0o600, name: str = "task-prompt.txt") -> str:
        path = os.path.join(self.run_dir, name)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
        os.chmod(path, mode)
        return path

    def test_reads_deletes_and_substitutes_prompt(self) -> None:
        path = self.write()
        environ = {ENV: path, "KEEP": "1"}
        result = LAUNCHER.consume_prompt_file(environ, self.argv, self.run_dir)
        self.assertEqual(result, ["shim.py", "--prompt", "review the auth module\n✓", "--agent", "plan", "--max-turns", "3"])
        self.assertFalse(os.path.exists(path))
        self.assertEqual(environ, {"KEEP": "1"})

    def test_missing_variable_fails_closed(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "requires a supervisor prompt file"):
            LAUNCHER.consume_prompt_file({}, self.argv, self.run_dir)

    def test_prompt_already_on_command_line_is_rejected(self) -> None:
        path = self.write()
        with self.assertRaisesRegex(RuntimeError, "command line"):
            LAUNCHER.consume_prompt_file({ENV: path}, [*self.argv, "--prompt", "leaked"], self.run_dir)
        self.assertTrue(os.path.exists(path))

    def test_relative_path_is_rejected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "absolute"):
            LAUNCHER.consume_prompt_file({ENV: "task-prompt.txt"}, self.argv, self.run_dir)

    def test_file_outside_run_directory_is_rejected_and_kept(self) -> None:
        with tempfile.TemporaryDirectory(prefix="vibe-prompt-other-") as other:
            path = os.path.join(other, "task-prompt.txt")
            Path(path).write_bytes(b"x")
            os.chmod(path, 0o600)
            with self.assertRaisesRegex(RuntimeError, "outside the run directory"):
                LAUNCHER.consume_prompt_file({ENV: path}, self.argv, self.run_dir)
            self.assertTrue(os.path.exists(path))

    def test_symlink_is_rejected(self) -> None:
        target = self.write(name="real.txt")
        link = os.path.join(self.run_dir, "task-prompt.txt")
        os.symlink(target, link)
        with self.assertRaisesRegex(RuntimeError, "Cannot open prompt file"):
            LAUNCHER.consume_prompt_file({ENV: link}, self.argv, self.run_dir)
        self.assertTrue(os.path.exists(target))

    def test_group_or_world_readable_file_is_rejected(self) -> None:
        path = self.write(mode=0o640)
        with self.assertRaisesRegex(RuntimeError, "owner-only"):
            LAUNCHER.consume_prompt_file({ENV: path}, self.argv, self.run_dir)

    def test_non_regular_file_is_rejected(self) -> None:
        path = os.path.join(self.run_dir, "task-prompt.txt")
        os.mkfifo(path, 0o600)
        with self.assertRaisesRegex(RuntimeError, "regular file|Cannot open"):
            LAUNCHER.consume_prompt_file({ENV: path}, self.argv, self.run_dir)

    def test_oversized_file_is_rejected(self) -> None:
        path = self.write(content=b"a" * (LAUNCHER.MAX_PROMPT_BYTES + 1))
        with self.assertRaisesRegex(RuntimeError, "size limit"):
            LAUNCHER.consume_prompt_file({ENV: path}, self.argv, self.run_dir)

    def test_invalid_utf8_is_rejected_after_deletion(self) -> None:
        path = self.write(content=b"\xff\xfe")
        with self.assertRaisesRegex(RuntimeError, "UTF-8"):
            LAUNCHER.consume_prompt_file({ENV: path}, self.argv, self.run_dir)
        self.assertFalse(os.path.exists(path))

    def test_missing_file_is_rejected(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "Cannot open prompt file"):
            LAUNCHER.consume_prompt_file({ENV: os.path.join(self.run_dir, "task-prompt.txt")}, self.argv, self.run_dir)


if __name__ == "__main__":
    unittest.main()
