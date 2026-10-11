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
        self.clock = FakeClock()
        self.parent = PARENT
        self.kills = 0

    def kill(self) -> None:
        self.kills += 1

    def build(self, timeout: int = 100, hard_cap: float = 10_000.0):
        return LAUNCHER.WorkerWatchdog(
            parent_pid=PARENT,
            timeout_seconds=timeout,
            hard_cap_seconds=hard_cap,
            wall_clock=lambda: self.clock.wall,
            monotonic_clock=lambda: self.clock.mono,
            get_parent_pid=lambda: self.parent,
            kill=self.kill,
        )

    def test_kills_at_the_fixed_one_shot_deadline(self) -> None:
        watchdog = self.build()
        self.clock.advance(99)
        self.assertFalse(watchdog.tick())
        self.clock.advance(1)
        self.assertTrue(watchdog.tick())
        self.assertEqual(self.kills, 1)

    def test_parent_death_kills_before_the_deadline(self) -> None:
        watchdog = self.build(timeout=100_000)
        self.parent = 1
        self.assertTrue(watchdog.tick())
        self.assertEqual(self.kills, 1)

    def test_hard_cap_bounds_a_long_one_shot_run(self) -> None:
        watchdog = self.build(timeout=100_000, hard_cap=1000.0)
        self.clock.advance(999)
        self.assertFalse(watchdog.tick())
        self.clock.advance(1)
        self.assertTrue(watchdog.tick())
        self.assertEqual(self.kills, 1)


class WatchdogConfigurationTest(unittest.TestCase):
    def test_hard_cap_is_two_days(self) -> None:
        self.assertEqual(LAUNCHER.HARD_CAP_SECONDS, 48 * 3600)


if __name__ == "__main__":
    unittest.main()
