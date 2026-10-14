"""Supervisor-owned public app-server bootstrap. Never patches Vibe internals."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import selectors
import signal
import stat
import subprocess
import sys
import threading
import time
from typing import Any, Callable, Optional

os.umask(0o077)
EXPECTED_VERSION = "2.26.1"
HARD_CAP_SECONDS = 48 * 3600
CREDENTIAL_ENV = "MISTRAL_API_KEY"
ORIGINAL_HOME_ENV = "VIBE_SUPERVISOR_ORIGINAL_HOME"
SECURITY_BINARY = "/usr/bin/security"
SECURITY_PATH = "/usr/bin:/bin"
KEYCHAIN_SERVICES = ("ai.mistral.vibe", "vibe")
KEYCHAIN_TIMEOUT_SECONDS = 5.0
MAX_KEYCHAIN_OUTPUT_BYTES = 8 * 1024
KEYCHAIN_EXIT_REASONS = {44: "not-found", 36: "locked", 51: "denied", 128: "denied"}
KEYCHAIN_REASON_PRIORITY = ("locked", "denied", "timeout", "oversize", "invalid-output", "error", "not-found")
Runner = Callable[[list, dict, float, int], tuple[int, bytes]]

def _run_bounded(argv: list, env: dict, timeout: float, limit: int) -> "tuple[int, bytes]":
    process = subprocess.Popen(argv, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, shell=False, close_fds=True)
    deadline = time.monotonic() + timeout
    chunks: list = []
    total = 0
    try:
        descriptor = process.stdout.fileno()
        with selectors.DefaultSelector() as selector:
            selector.register(descriptor, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining):
                    raise TimeoutError("keychain lookup timed out")
                data = os.read(descriptor, 4096)
                if not data:
                    break
                total += len(data)
                if total > limit:
                    raise OverflowError("keychain output too large")
                chunks.append(data)
        try:
            process.wait(timeout=max(0.01, deadline - time.monotonic()))
        except subprocess.TimeoutExpired as exc:
            raise TimeoutError("keychain lookup timed out") from exc
        return process.returncode, b"".join(chunks)
    finally:
        if process.poll() is None:
            process.kill()
        process.stdout.close()
        process.wait()

def check_original_home(raw: Optional[str]) -> "tuple[Optional[str], str]":
    if not raw:
        return None, "unset"
    if "\0" in raw:
        return None, "not-normalized"
    if not os.path.isabs(raw):
        return None, "not-absolute"
    path = raw.rstrip("/")
    if not path or os.path.normpath(path) != path:
        return None, "not-normalized"
    try:
        info = os.lstat(path)
    except OSError:
        return None, "missing"
    if stat.S_ISLNK(info.st_mode):
        return None, "symlink"
    if not stat.S_ISDIR(info.st_mode):
        return None, "not-directory"
    if info.st_uid != os.getuid():
        return None, "not-owner"
    return path, "ok"

def _decode_credential(output: bytes) -> Optional[str]:
    try:
        text = output.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if text.endswith("\n"):
        text = text[:-1]
    if not text or any(character in text for character in ("\0", "\r", "\n")):
        return None
    return text

def _reason_rank(reason: str) -> int:
    base = "error" if reason.startswith("error") else reason
    return KEYCHAIN_REASON_PRIORITY.index(base)

def lookup_keychain_credential(home: str, runner: Runner = _run_bounded, executable: str = SECURITY_BINARY) -> "tuple[Optional[str], str, str]":
    environment = {"HOME": home, "PATH": SECURITY_PATH}
    reasons: list = []
    for service in KEYCHAIN_SERVICES:
        argv = [executable, "find-generic-password", "-a", CREDENTIAL_ENV, "-s", service, "-w"]
        try:
            code, output = runner(argv, environment, KEYCHAIN_TIMEOUT_SECONDS, MAX_KEYCHAIN_OUTPUT_BYTES)
        except TimeoutError:
            reasons.append((service, "timeout"))
            continue
        except OverflowError:
            reasons.append((service, "oversize"))
            continue
        except Exception:
            reasons.append((service, "error"))
            continue
        if code != 0:
            reasons.append((service, KEYCHAIN_EXIT_REASONS.get(code, f"error-{code}")))
            continue
        credential = _decode_credential(output)
        if credential is None:
            reasons.append((service, "invalid-output"))
            continue
        return credential, "found", ""
    detail = ",".join(f"{service}={reason}" for service, reason in reasons)
    top = min((reason for _, reason in reasons), key=_reason_rank, default="not-found")
    return None, top, detail

def resolve_credential(
    environ: Any,
    original_home: Optional[str],
    platform: str = sys.platform,
    runner: Runner = _run_bounded,
    executable: str = SECURITY_BINARY,
) -> str:
    if environ.get(CREDENTIAL_ENV):
        return "environment"
    environ.pop(CREDENTIAL_ENV, None)
    if platform != "darwin":
        return "skipped-platform"
    home, home_reason = check_original_home(original_home)
    if home is None:
        return f"skipped-home:{home_reason}"
    credential, reason, detail = lookup_keychain_credential(home, runner, executable)
    if credential is None:
        return f"{reason} ({detail})"
    environ[CREDENTIAL_ENV] = credential
    return "keychain"

class WorkerWatchdog:
    def __init__(
        self,
        parent_pid: int,
        timeout_seconds: int,
        hard_cap_seconds: float,
        wall_clock: Callable[[], float],
        monotonic_clock: Callable[[], float],
        get_parent_pid: Callable[[], int],
        kill: Callable[[], None],
    ) -> None:
        self.parent_pid = parent_pid
        self.hard_cap_seconds = hard_cap_seconds
        self.wall_clock = wall_clock
        self.monotonic_clock = monotonic_clock
        self.get_parent_pid = get_parent_pid
        self.kill = kill
        self.started = monotonic_clock()
        self.deadline = wall_clock() + timeout_seconds

    def tick(self) -> bool:
        if self.get_parent_pid() != self.parent_pid:
            self.kill()
            return True
        if self.monotonic_clock() - self.started >= self.hard_cap_seconds or self.wall_clock() >= self.deadline:
            self.kill()
            return True
        return False

def _start_parent_watchdog() -> None:
    try:
        timeout = max(1, int(os.environ.get("VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS", "2400")))
    except ValueError as exc:
        raise RuntimeError("Invalid VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS") from exc

    def terminate_own_group() -> None:
        pgid = os.getpgrp()
        if pgid != os.getpid():
            os.kill(os.getpid(), signal.SIGKILL)
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    watchdog = WorkerWatchdog(
        parent_pid=os.getppid(),
        timeout_seconds=timeout,
        hard_cap_seconds=min(HARD_CAP_SECONDS, timeout),
        wall_clock=time.time,
        monotonic_clock=time.monotonic,
        get_parent_pid=os.getppid,
        kill=terminate_own_group,
    )

    def monitor() -> None:
        while True:
            time.sleep(1)
            if watchdog.tick():
                return

    threading.Thread(target=monitor, name="vibe-supervisor-parent-watchdog", daemon=True).start()


def verify_manifest(site_root: Path, manifest: dict) -> int:
    if site_root.resolve() != site_root or not site_root.is_dir():
        raise RuntimeError("unsafe-site-root")
    files = manifest.get("files")
    if not isinstance(files, dict) or not 1 <= len(files) <= 4096:
        raise RuntimeError("invalid-manifest")
    for relative, expected in files.items():
        if not isinstance(relative, str) or not isinstance(expected, str):
            raise RuntimeError("invalid-manifest")
        parts = Path(relative).parts
        if Path(relative).is_absolute() or any(part in ("", ".", "..") for part in parts) or "\\" in relative:
            raise RuntimeError("unsafe-manifest-path")
        target = site_root / relative
        if target.parent.resolve() != target.parent:
            raise RuntimeError("symlinked-runtime-directory")
        flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
        fd = os.open(target, flags)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_mode & 0o022 or before.st_size > 256 * 1024 * 1024:
                raise RuntimeError("unsafe-runtime-file")
            digest = hashlib.sha256()
            size = 0
            while block := os.read(fd, 1024 * 1024):
                size += len(block)
                if size > 256 * 1024 * 1024:
                    raise RuntimeError("runtime-file-limit")
                digest.update(block)
            after = os.fstat(fd)
            named = os.lstat(target)
            if size != before.st_size or after.st_mtime_ns != before.st_mtime_ns or after.st_ctime_ns != before.st_ctime_ns or named.st_ino != before.st_ino or named.st_dev != before.st_dev:
                raise RuntimeError("runtime-file-changed")
            if digest.hexdigest() != expected:
                raise RuntimeError("runtime-hash-mismatch")
        finally:
            os.close(fd)
    return len(files)


def require_private_directory(name: str) -> Path:
    value = os.environ.get(name)
    if not value or not os.path.isabs(value):
        raise RuntimeError("missing-private-directory")
    directory = Path(value)
    info = directory.lstat()
    if directory.resolve() != directory or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError("unsafe-private-directory")
    return directory


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--site-root", required=True)
    parser.add_argument("--check-only", action="store_true")
    options = parser.parse_args()
    if sys.version_info[:2] != (3, 12) or sys.implementation.name != "cpython" or sys.platform != "darwin" or platform.machine() != "arm64":
        raise RuntimeError("unsupported-interpreter")
    home = require_private_directory("HOME")
    vibe_home = require_private_directory("VIBE_HOME")
    temporary = require_private_directory("TMPDIR")
    if home == vibe_home or home == temporary or vibe_home == temporary:
        raise RuntimeError("overlapping-private-directories")
    # -I -S prevents site startup and .pth hooks; this prefix also prevents
    # timestamp-forged package __pycache__ from being imported after pinning.
    if not sys.flags.isolated or not sys.flags.no_site:
        raise RuntimeError("unsafe-interpreter-flags")
    sys.pycache_prefix = str(temporary / "bytecode")
    sys.dont_write_bytecode = True
    manifest_path = Path(__file__).resolve().parent.parent / "app-server" / "vibe-2.26.1-macos-arm64.json"
    if manifest_path.is_symlink() or manifest_path.stat().st_size > 1024 * 1024:
        raise RuntimeError("unsafe-manifest")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("format") != 1 or manifest.get("vibe_version") != EXPECTED_VERSION:
        raise RuntimeError("invalid-manifest")
    if not options.check_only:
        _start_parent_watchdog()
    site = Path(options.site_root)
    checked = verify_manifest(site, manifest)
    if options.check_only:
        print(json.dumps({"vibe_version": EXPECTED_VERSION, "python": "3.12", "files_checked": checked, "vibe_imported": False}))
        return 0
    original_home = os.environ.pop(ORIGINAL_HOME_ENV, None)
    resolve_credential(os.environ, original_home)
    sys.path.append(str(site))
    sys.argv = ["vibe-app-server"]
    # This is the wheel's declared public console entry point. No internal
    # methods, properties, tool executors or persistence writers are patched.
    from vibe.app_server.stdio import main as app_server_main
    app_server_main()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        sys.stderr.write("vibe-supervisor: app-server bootstrap refused the runtime or failed initialization.\n")
        raise SystemExit(1)
