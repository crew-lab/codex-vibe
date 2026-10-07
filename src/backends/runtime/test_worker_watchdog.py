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

PARENT = 4242
START = 1_000_000.0


class FakeClock:
    def __init__(self) -> None:
        self.wall = START
        self.mono = 50.0

    def advance(self, seconds: float) -> None:
        self.wall += seconds
        self.mono += seconds


class WorkerWatchdogTest(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory(prefix="vibe-watchdog-fixture-")
        self.addCleanup(self._temp.cleanup)
        self.directory = os.path.realpath(self._temp.name)
        self.deadline_path = os.path.join(self.directory, "worker-deadline")
        self.clock = FakeClock()
        self.parent = PARENT
        self.kills = 0

    def kill(self) -> None:
        self.kills += 1

    def build(self, timeout: int = 100, use_file: bool = True, hard_cap: float = 10_000.0, uid: int | None = None):
        return LAUNCHER.WorkerWatchdog(
            parent_pid=PARENT,
            expected_directory=self.directory,
            owner_uid=os.getuid() if uid is None else uid,
            timeout_seconds=timeout,
            deadline_file=self.deadline_path if use_file else None,
            hard_cap_seconds=hard_cap,
            wall_clock=lambda: self.clock.wall,
            monotonic_clock=lambda: self.clock.mono,
            get_parent_pid=lambda: self.parent,
            kill=self.kill,
        )

    def write(self, text: str, mode: int = 0o600) -> None:
        descriptor = os.open(self.deadline_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(text)
        os.chmod(self.deadline_path, mode)

    def test_kills_at_initial_deadline_without_a_file(self) -> None:
        watchdog = self.build(use_file=False)
        self.clock.advance(99)
        self.assertFalse(watchdog.tick())
        self.clock.advance(1)
        self.assertTrue(watchdog.tick())
        self.assertEqual(self.kills, 1)

    def test_extends_when_file_moves_deadline_forward(self) -> None:
        watchdog = self.build()
        self.clock.advance(90)
        self.write(str(int(START + 500)))
        self.assertFalse(watchdog.tick())
        self.clock.advance(200)
        self.assertFalse(watchdog.tick())
        self.clock.advance(210)
        self.assertTrue(watchdog.tick())

    def test_shortens_when_file_moves_deadline_back(self) -> None:
        watchdog = self.build(timeout=1000)
        self.clock.advance(10)
        self.write(str(int(START + 20)))
        self.assertFalse(watchdog.tick())
        self.clock.advance(10)
        self.assertTrue(watchdog.tick())

    def test_malformed_files_keep_the_last_deadline(self) -> None:
        watchdog = self.build()
        for text in ("", "soon", "nan", "inf", "-5", "0", "1e999", "1 2", "9" * 100):
            self.write(text)
            self.clock.advance(1)
            self.assertFalse(watchdog.tick(), text)
        self.clock.advance(100)
        self.assertTrue(watchdog.tick())

    def test_missing_file_keeps_the_last_deadline(self) -> None:
        watchdog = self.build()
        self.write(str(int(START + 300)))
        self.clock.advance(50)
        self.assertFalse(watchdog.tick())
        os.unlink(self.deadline_path)
        self.clock.advance(200)
        self.assertFalse(watchdog.tick())
        self.clock.advance(60)
        self.assertTrue(watchdog.tick())

    def test_symlinked_file_is_ignored(self) -> None:
        target = os.path.join(self.directory, "elsewhere")
        with open(target, "w") as handle:
            handle.write(str(int(START + 5000)))
        os.chmod(target, 0o600)
        os.symlink(target, self.deadline_path)
        watchdog = self.build()
        self.clock.advance(100)
        self.assertTrue(watchdog.tick())

    def test_group_or_world_accessible_file_is_ignored(self) -> None:
        self.write(str(int(START + 5000)), mode=0o644)
        watchdog = self.build()
        self.clock.advance(100)
        self.assertTrue(watchdog.tick())

    def test_non_owner_file_is_ignored(self) -> None:
        self.write(str(int(START + 5000)))
        watchdog = self.build(uid=os.getuid() + 1)
        self.clock.advance(100)
        self.assertTrue(watchdog.tick())

    def test_directory_in_place_of_the_file_is_ignored(self) -> None:
        os.mkdir(self.deadline_path)
        watchdog = self.build()
        self.clock.advance(100)
        self.assertTrue(watchdog.tick())

    def test_relative_path_is_ignored(self) -> None:
        self.write(str(int(START + 5000)))
        self.deadline_path = "worker-deadline"
        watchdog = self.build()
        self.clock.advance(100)
        self.assertTrue(watchdog.tick())

    def test_hard_cap_wins_over_an_ever_extended_file(self) -> None:
        watchdog = self.build(timeout=100, hard_cap=1000.0)
        for _ in range(9):
            self.clock.advance(100)
            self.write(str(int(self.clock.wall + 10_000)))
            self.assertFalse(watchdog.tick())
        self.clock.advance(100)
        self.write(str(int(self.clock.wall + 10_000)))
        self.assertTrue(watchdog.tick())
        self.assertEqual(self.kills, 1)

    def test_parent_death_kills_regardless_of_the_deadline(self) -> None:
        watchdog = self.build()
        self.write(str(int(START + 100_000)))
        self.parent = 1
        self.assertTrue(watchdog.tick())
        self.assertEqual(self.kills, 1)

    def test_file_outside_the_shim_directory_is_ignored(self) -> None:
        other = tempfile.TemporaryDirectory(prefix="vibe-watchdog-other-")
        self.addCleanup(other.cleanup)
        outside = os.path.join(os.path.realpath(other.name), "worker-deadline")
        descriptor = os.open(outside, os.O_WRONLY | os.O_CREAT, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(str(int(START + 5000)))
        self.deadline_path = outside
        watchdog = self.build()
        self.clock.advance(100)
        self.assertTrue(watchdog.tick())


class WatchdogConfigurationTest(unittest.TestCase):
    def test_hard_cap_is_two_days(self) -> None:
        self.assertEqual(LAUNCHER.HARD_CAP_SECONDS, 48 * 3600)

    def test_environment_names(self) -> None:
        self.assertEqual(LAUNCHER.WORKER_DEADLINE_FILE_ENV, "VIBE_SUPERVISOR_WORKER_DEADLINE_FILE")


if __name__ == "__main__":
    unittest.main()
