"""Pinned Vibe runtime shim. This file runs inside the isolated child only."""
from __future__ import annotations

import asyncio
import atexit
import hashlib
import inspect
import json
import sysconfig
import os
import re
import selectors
import signal
import stat
import subprocess
import sys
import threading
import time
from typing import Any, Callable, Optional

EXPECTED_VERSION = "2.26.1"
PROJECT_DISCOVERY_SOURCE_SHA256 = "43fc21e2d1a7359ac896ab41e902d927d363ba4ef8f989909af8bcca4b82cbac"
TOOL_INVOKE_SOURCE_SHA256 = "7e178d97a11840f13f87622b2c854c63c8204a6f8e52873d0aa3d96aa67f6312"
TOOL_INVENTORY_SOURCE_SHA256 = "93ca0fc756a12bd1f865fa8f7b65ac21ff00b111892ec12136b3818bb9437533"
TOOL_SCHEMA_SOURCE_SHA256 = "3fbc8ca4b9458b0e48060dd70ed69d7ffd3b094e321f9a9a56d43cba795a6c06"
TOOL_CALL_RESOLUTION_SOURCE_SHA256 = "323d892e37da3835e4c56ea9f33c9d93c1fe5dc9bf0e2aee6e9dbb08be5b661e"
TOOL_LOOKUP_SOURCE_SHA256 = "03e7d2a53fe180d50dc3feebebb2ad420f3841551a471735d5e889113166bf37"
DISABLED_SKILLS_ENV = "VIBE_DISABLED_SKILLS"
ENABLED_SKILLS_ENV = "VIBE_ENABLED_SKILLS"
# Set restrictive permissions before importing Vibe or creating its state.
os.umask(0o077)
PROGRAMMATIC_ENTRYPOINT = "vibe.cli.entrypoint"
PROMPT_FILE_ENV = "VIBE_SUPERVISOR_PROMPT_FILE"
MAX_PROMPT_BYTES = 4 * 1024 * 1024
HARD_CAP_SECONDS = 48 * 3600
ORIGINAL_HOME_ENV = "VIBE_SUPERVISOR_ORIGINAL_HOME"
CREDENTIAL_ENV = "MISTRAL_API_KEY"
SECURITY_BINARY = "/usr/bin/security"
KEYCHAIN_SERVICES = ("ai.mistral.vibe", "vibe")
SECURITY_PATH = "/usr/bin:/bin"
KEYCHAIN_TIMEOUT_SECONDS = 5.0
MAX_KEYCHAIN_OUTPUT_BYTES = 8 * 1024
_SECRET_PATTERNS = (
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]+=*", re.IGNORECASE),
    re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    re.compile(r"\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*[^\s,;]+", re.IGNORECASE),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
)


def consume_prompt_file(environ: Any, argv: list[str], expected_directory: str) -> list[str]:
    raw_path = environ.pop(PROMPT_FILE_ENV, None)
    if not raw_path:
        raise RuntimeError("Programmatic launch requires a supervisor prompt file")
    if "--prompt" in argv or "-p" in argv:
        raise RuntimeError("Programmatic launch must not receive a prompt on the command line")
    if not os.path.isabs(raw_path):
        raise RuntimeError("Prompt file path must be absolute")
    directory = os.path.realpath(os.path.dirname(raw_path))
    if directory != os.path.realpath(expected_directory):
        raise RuntimeError("Prompt file is outside the run directory")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        descriptor = os.open(raw_path, flags)
    except OSError as exc:
        raise RuntimeError(f"Cannot open prompt file: {exc.strerror}") from exc
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError("Prompt file is not a regular file")
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise RuntimeError("Prompt file must be owner-only and owned by the current user")
        if info.st_size > MAX_PROMPT_BYTES:
            raise RuntimeError("Prompt file exceeds the size limit")
        data = os.read(descriptor, MAX_PROMPT_BYTES + 1)
    finally:
        os.close(descriptor)
    try:
        os.unlink(raw_path)
    except OSError as exc:
        raise RuntimeError(f"Cannot delete prompt file: {exc.strerror}") from exc
    if len(data) > MAX_PROMPT_BYTES:
        raise RuntimeError("Prompt file exceeds the size limit")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError("Prompt file is not valid UTF-8") from exc
    return [argv[0], "--prompt", text, *argv[1:]]


Runner = Callable[[list, dict, float, int], "tuple[int, bytes]"]


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


def trusted_original_home(raw: Optional[str]) -> Optional[str]:
    return check_original_home(raw)[0]


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


KEYCHAIN_EXIT_REASONS = {44: "not-found", 36: "locked", 51: "denied", 128: "denied"}
KEYCHAIN_REASON_PRIORITY = ("locked", "denied", "timeout", "oversize", "invalid-output", "error", "not-found")


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


class RedactingStream:
    def __init__(self, stream: Any, secret: str) -> None:
        self._stream = stream
        self._secret = secret
        self._pending = ""
        self._lock = threading.Lock()

    def _drain(self, include_partial: bool, final: bool = False) -> None:
        text = self._pending.replace(self._secret, "[REDACTED]")
        if final:
            cut = len(text)
        else:
            cut = text.rfind("\n") + 1
            if include_partial:
                cut = max(cut, len(text) - (len(self._secret) - 1))
        if cut:
            self._stream.write(text[:cut])
        self._pending = text[cut:]

    def write(self, text: str) -> int:
        with self._lock:
            self._pending += text
            self._drain(include_partial=len(self._pending) > 65536)
        return len(text)

    def flush(self, final: bool = False) -> None:
        with self._lock:
            self._drain(include_partial=True, final=final)
        self._stream.flush()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._stream, name)


def _install_stderr_redaction(secret: str) -> None:
    if len(secret) < 4:
        return
    stream = RedactingStream(sys.stderr, secret)
    sys.stderr = stream
    atexit.register(lambda: stream.flush(final=True))


def _redact(value: Any) -> Any:
    if isinstance(value, list):
        return [_redact(item) for item in value]
    if isinstance(value, tuple):
        return [_redact(item) for item in value]
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered.startswith(("reasoning", "thought", "chain_of_thought")):
                continue
            if any(part in lowered for part in ("api_key", "apikey", "access_token", "refresh_token", "password", "authorization", "cookie", "secret")):
                result[str(key)] = "[REDACTED]"
                continue
            result[str(key)] = _redact(item)
        return result
    if isinstance(value, str):
        api_key = os.environ.get("MISTRAL_API_KEY", "")
        if len(api_key) >= 4:
            value = value.replace(api_key, "[REDACTED]")
        for pattern in _SECRET_PATTERNS:
            value = pattern.sub("[REDACTED]", value)
        return value
    return value


def _patch_project_discovery(manager_module: Any = None) -> None:
    if manager_module is None:
        from vibe.core.config.harness_files import _harness_manager as manager_module
    try:
        source = inspect.getsource(manager_module)
    except (OSError, TypeError) as exc:
        raise RuntimeError("Unsupported Vibe project discovery: source unavailable") from exc
    if hashlib.sha256(source.encode("utf-8")).hexdigest() != PROJECT_DISCOVERY_SOURCE_SHA256:
        raise RuntimeError("Unsupported Vibe project discovery: source drift")
    manager = manager_module.HarnessFilesManager
    for name in ("project_source_enabled", "project_roots"):
        member = vars(manager).get(name)
        if not isinstance(member, property) or member.fget is None or list(inspect.signature(member.fget).parameters) != ["self"]:
            raise RuntimeError(f"Unsupported Vibe project discovery property: {name}")

    def project_disabled(self: Any) -> bool:
        return False

    def no_project_roots(self: Any) -> list:
        return []

    manager.project_source_enabled = property(project_disabled)
    manager.project_roots = property(no_project_roots)


def _patch_session_logger() -> None:
    from vibe.core.session.session_logger import SessionLogger

    expected = {
        "_persist_messages_sync": ["messages", "session_dir"],
        "_overwrite_messages_sync": ["messages", "session_dir"],
        "_persist_metadata_sync": ["metadata", "session_dir"],
    }
    originals: dict[str, Any] = {}
    for name, parameter_names in expected.items():
        method = getattr(SessionLogger, name, None)
        if method is None:
            raise RuntimeError(f"Unsupported Vibe SessionLogger: missing {name}")
        signature = inspect.signature(method)
        if list(signature.parameters) != parameter_names:
            raise RuntimeError(f"Unsupported Vibe SessionLogger signature for {name}: {signature}")
        originals[name] = method

    original_append = originals["_persist_messages_sync"]
    original_overwrite = originals["_overwrite_messages_sync"]
    original_metadata = originals["_persist_metadata_sync"]

    def persist_messages(messages: list[dict], session_dir: Any) -> None:
        original_append([_redact(message) for message in messages], session_dir)

    def overwrite_messages(messages: list[dict], session_dir: Any) -> None:
        original_overwrite([_redact(message) for message in messages], session_dir)

    def persist_metadata(metadata: Any, session_dir: Any) -> None:
        original_metadata(_redact(metadata), session_dir)

    SessionLogger._persist_messages_sync = staticmethod(persist_messages)
    SessionLogger._overwrite_messages_sync = staticmethod(overwrite_messages)
    SessionLogger._persist_metadata_sync = staticmethod(persist_metadata)


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
        hard_cap_seconds=HARD_CAP_SECONDS,
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


DIAGNOSTICS_ENV = "VIBE_SUPERVISOR_DIAGNOSTICS"
DIAGNOSTICS_FILE = "worker-diagnostics.json"
MAX_DIAGNOSTICS_BYTES = 64 * 1024
DIAGNOSTIC_STAGES = ("launch", "import", "prompt_consumption", "persistence_setup", "credential_resolution_complete", "entrypoint_invocation")
TOOL_CALL_LIMIT = 256
TOOL_CALL_OUTCOMES = ("attempt", "completed", "failed", "refused", "cancelled")
KNOWN_SUPERVISOR_TOOL_NAMES = frozenset(("read_file", "grep", "write_file", "edit"))
SAFE_TOOL_NAME = re.compile(r"[A-Za-z0-9_.-]{1,64}")


class WorkerDiagnostics:
    """Optional metadata only; no frame locals, arguments or source lines."""
    def __init__(self, directory: str, clock: Callable[[], float] = time.monotonic,
                 frames: Callable[[], Any] = sys._current_frames) -> None:
        self.directory = directory
        self.clock = clock
        self.frames = frames
        self.started = clock()
        self.stages: list[dict[str, Any]] = []
        self.snapshots: list[dict[str, Any]] = []
        self.tool_inventory: list[str] = []
        self.tool_calls: list[dict[str, str]] = []
        self.tool_calls_truncated = False
        self.next_snapshot = 0
        self.disabled = False
        self.descriptor: Optional[int] = None
        self.lock = threading.Lock()
        self.io_lock = threading.Lock()
        self.roots = sorted(set(os.path.realpath(sysconfig.get_path(key)) for key in ("stdlib", "purelib")), key=len, reverse=True)

    def stage(self, name: str) -> None:
        if name not in DIAGNOSTIC_STAGES or self.disabled:
            return
        with self.lock:
            if any(item["stage"] == name for item in self.stages):
                return
            self.stages.append({"stage": name, "elapsed_ms": max(0, int((self.clock() - self.started) * 1000))})

    def snapshot(self, elapsed: float) -> dict[str, Any]:
        threads = []
        for frame in list(self.frames().values())[:8]:
            entries = []
            for _ in range(12):
                if frame is None:
                    break
                filename = os.path.realpath(frame.f_code.co_filename)
                relative = "<external>"
                if filename == os.path.realpath(__file__):
                    relative = "runtime/vibe_supervisor_launcher.py"
                else:
                    for root in self.roots:
                        if filename.startswith(root + os.sep):
                            relative = os.path.relpath(filename, root)
                            break
                function = frame.f_code.co_name if relative != "<external>" else "<external>"
                if not re.fullmatch(r"[A-Za-z0-9_./<>-]{1,160}", relative):
                    relative = "<external>"
                if not re.fullmatch(r"[A-Za-z0-9_.<>-]{1,96}", function):
                    function = "<unknown>"
                entry = _redact({"file": relative, "function": function, "line": max(0, frame.f_lineno)})
                if entry["file"] != relative:
                    entry["file"] = "<redacted>"
                if entry["function"] != function:
                    entry["function"] = "<redacted>"
                entries.append(entry)
                frame = frame.f_back
            threads.append(entries)
        result = {"elapsed_ms": max(0, int(elapsed * 1000)), "threads": threads}
        while len(json.dumps(result).encode("utf-8")) > 16 * 1024 and threads:
            threads.pop()
        return result

    def record_tool_inventory(self, names: Any) -> None:
        if self.disabled or self.tool_inventory:
            return
        safe_names = sorted({name if name in KNOWN_SUPERVISOR_TOOL_NAMES else "<other>"
                             for name in names if isinstance(name, str)})
        with self.lock:
            if not self.tool_inventory:
                self.tool_inventory = safe_names

    def record_tool_call(self, name: Any, outcome: str) -> None:
        if self.disabled or outcome not in TOOL_CALL_OUTCOMES:
            return
        safe_name = name if isinstance(name, str) and name in KNOWN_SUPERVISOR_TOOL_NAMES else "<other>"
        with self.lock:
            if len(self.tool_calls) >= TOOL_CALL_LIMIT:
                self.tool_calls_truncated = True
            else:
                self.tool_calls.append({"tool": safe_name, "outcome": outcome})

    def tick(self) -> None:
        with self.io_lock:
            self._tick_locked()

    def _tick_locked(self) -> None:
        if self.disabled:
            return
        try:
            if self.descriptor is None:
                if not os.path.isabs(self.directory) or self.directory != os.path.realpath(self.directory):
                    raise ValueError("noncanonical diagnostic directory")
                info = os.lstat(self.directory)
                if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                    raise ValueError("unsafe diagnostic directory")
                self.descriptor = os.open(os.path.join(self.directory, DIAGNOSTICS_FILE), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0), 0o600)
            elapsed = self.clock() - self.started
            if self.next_snapshot < 3 and elapsed >= (60, 180, 600)[self.next_snapshot]:
                self.snapshots.append(self.snapshot(elapsed))
                self.next_snapshot += 1
            with self.lock:
                stages = list(self.stages)
                tool_inventory = list(self.tool_inventory)
                tool_calls = list(self.tool_calls)
            data = json.dumps({"schema_version": 1, "stages": stages, "snapshots": self.snapshots,
                               "tool_inventory": tool_inventory, "tool_calls": tool_calls,
                               "tool_calls_truncated": self.tool_calls_truncated}, separators=(",", ":")).encode("utf-8")
            if len(data) > MAX_DIAGNOSTICS_BYTES:
                raise ValueError("diagnostic size limit")
            info = os.fstat(self.descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
                raise ValueError("unsafe diagnostic file")
            os.lseek(self.descriptor, 0, os.SEEK_SET)
            offset = 0
            while offset < len(data):
                written = os.write(self.descriptor, data[offset:])
                if written <= 0:
                    raise OSError("diagnostic write failed")
                offset += written
            os.ftruncate(self.descriptor, len(data))
        except Exception:
            self.disabled = True
            self._close_locked()

    def close(self) -> None:
        with self.io_lock:
            self.disabled = True
            self._close_locked()

    def _close_locked(self) -> None:
        if self.descriptor is not None:
            try:
                os.close(self.descriptor)
            except OSError:
                pass
            self.descriptor = None


def _start_diagnostics() -> Optional[WorkerDiagnostics]:
    enabled = os.environ.pop(DIAGNOSTICS_ENV, None) == "1"
    if not enabled:
        return None
    try:
        recorder = WorkerDiagnostics(os.path.dirname(os.path.realpath(__file__)))
        recorder.stage("launch")
        def monitor() -> None:
            while not recorder.disabled:
                recorder.tick()
                time.sleep(1)
        threading.Thread(target=monitor, name="vibe-supervisor-diagnostics", daemon=True).start()
        return recorder
    except Exception:
        return None


class ToolOutsideProfileError(PermissionError):
    pass


def _assert_pinned_source(member: Any, expected_sha256: str, description: str) -> None:
    try:
        source = inspect.getsource(member)
    except (OSError, TypeError) as exc:
        raise RuntimeError(f"Unsupported Vibe {description}: source unavailable; refusing tool profile") from exc
    if hashlib.sha256(source.encode("utf-8")).hexdigest() != expected_sha256:
        raise RuntimeError(f"Unsupported Vibe {description} implementation; refusing tool profile")


def _assert_skills_disabled(environ: Any = os.environ) -> None:
    try:
        disabled = json.loads(environ.get(DISABLED_SKILLS_ENV, ""))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Invalid Vibe supervisor skill profile; refusing to start") from exc
    if disabled != ["*"]:
        raise RuntimeError("Unexpected Vibe supervisor skill profile; every skill must be disabled")
    if ENABLED_SKILLS_ENV in environ:
        raise RuntimeError("Unexpected Vibe supervisor skill profile; enabled skills would override the disabled set")


def _patch_tool_diagnostics(diagnostics: Optional[WorkerDiagnostics]) -> None:
    """Enforce the exact local tool profile at discovery and execution; optionally record metadata only."""
    from vibe.core.llm.format import APIToolFormatHandler
    from vibe.core.tools.base import BaseTool
    from vibe.core.tools.manager import ToolManager

    invoke = getattr(BaseTool, "_vibe_supervisor_original_invoke", BaseTool.invoke)
    inventory_property = getattr(ToolManager, "_vibe_supervisor_original_available_tools", ToolManager.available_tools)
    if not inspect.isasyncgenfunction(invoke) or list(inspect.signature(invoke).parameters) != ["self", "ctx", "raw"]:
        raise RuntimeError("Unsupported Vibe tool invocation API; refusing tool profile")
    if not isinstance(inventory_property, property) or inventory_property.fget is None or list(inspect.signature(inventory_property.fget).parameters) != ["self"]:
        raise RuntimeError("Unsupported Vibe effective tool inventory API; refusing tool profile")
    _assert_pinned_source(invoke, TOOL_INVOKE_SOURCE_SHA256, "tool invocation")
    _assert_pinned_source(inventory_property.fget, TOOL_INVENTORY_SOURCE_SHA256, "effective tool inventory")
    _assert_pinned_source(APIToolFormatHandler.get_available_tools, TOOL_SCHEMA_SOURCE_SHA256, "tool schema exposure")
    _assert_pinned_source(APIToolFormatHandler.resolve_tool_calls, TOOL_CALL_RESOLUTION_SOURCE_SHA256, "tool call resolution")
    _assert_pinned_source(ToolManager.get, TOOL_LOOKUP_SOURCE_SHA256, "tool lookup")

    mode_tools = {
        "plan": frozenset(("read_file", "grep")),
        "accept-edits": frozenset(("read_file", "grep", "write_file", "edit")),
    }
    agent = os.environ.get("VIBE_DEFAULT_AGENT")
    expected_tools = mode_tools.get(agent or "")
    if expected_tools is None:
        raise RuntimeError("Unsupported Vibe supervisor agent profile; refusing effective tool inventory")
    try:
        configured_tools = json.loads(os.environ.get("VIBE_ENABLED_TOOLS", ""))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Invalid Vibe supervisor tool profile; refusing effective tool inventory") from exc
    if not isinstance(configured_tools, list) or set(configured_tools) != expected_tools:
        raise RuntimeError("Unexpected Vibe supervisor tool profile; refusing effective tool inventory")

    def record_call(name: Any, outcome: str) -> None:
        if diagnostics is not None:
            diagnostics.record_tool_call(name, outcome)

    def available_tools(self: Any) -> dict:
        result = inventory_property.fget(self)
        if set(result) != expected_tools:
            raise RuntimeError("Effective Vibe tool inventory does not match the supervisor profile")
        if diagnostics is not None:
            diagnostics.record_tool_inventory(result.keys())
        return result

    async def guarded_invoke(self: Any, ctx: Any = None, **raw: Any):
        name = self.get_name()
        if name not in expected_tools:
            record_call(name, "refused")
            printable = name if isinstance(name, str) and SAFE_TOOL_NAME.fullmatch(name) else "<other>"
            raise ToolOutsideProfileError(f"Tool {printable} is outside the supervisor tool profile")
        record_call(name, "attempt")
        try:
            async for item in invoke(self, ctx, **raw):
                yield item
        except (asyncio.CancelledError, GeneratorExit):
            record_call(name, "cancelled")
            raise
        except Exception:
            record_call(name, "failed")
            raise
        else:
            record_call(name, "completed")

    ToolManager.available_tools = property(available_tools)
    ToolManager._vibe_supervisor_original_available_tools = inventory_property
    BaseTool.invoke = guarded_invoke
    BaseTool._vibe_supervisor_original_invoke = invoke


def _finish_diagnostics(diagnostics: Optional[WorkerDiagnostics]) -> None:
    if diagnostics is None:
        return
    diagnostics.tick()
    diagnostics.close()


def main() -> None:
    original_home = os.environ.pop(ORIGINAL_HOME_ENV, None)
    _start_parent_watchdog()
    diagnostics = _start_diagnostics()
    try:
        _run_vibe_entrypoint(diagnostics, original_home)
    finally:
        _finish_diagnostics(diagnostics)


def _run_vibe_entrypoint(diagnostics: Optional[WorkerDiagnostics], original_home: Optional[str]) -> None:
    import vibe
    if diagnostics:
        diagnostics.stage("import")

    if vibe.__version__ != EXPECTED_VERSION:
        raise SystemExit(f"Vibe privacy shim supports exactly {EXPECTED_VERSION}; found {vibe.__version__}")
    sys.argv = consume_prompt_file(os.environ, sys.argv, os.path.dirname(os.path.realpath(__file__)))
    if diagnostics:
        diagnostics.stage("prompt_consumption")
    _patch_project_discovery()
    _patch_session_logger()
    _patch_tool_diagnostics(diagnostics)
    _assert_skills_disabled()
    if diagnostics:
        diagnostics.stage("persistence_setup")
    status = resolve_credential(os.environ, original_home)
    if diagnostics:
        diagnostics.stage("credential_resolution_complete")
    if status == "keychain":
        _install_stderr_redaction(os.environ[CREDENTIAL_ENV])
    elif status not in ("environment", "skipped-platform"):
        sys.stderr.write(f"vibe-supervisor: no Keychain credential resolved ({status}); Vibe will use its own authentication\n")
    # Suppress Vibe's info-level prompt logging. The isolated VIBE_HOME still
    # retains recovery messages after recursive reasoning/key redaction.
    os.environ["LOG_LEVEL"] = "ERROR"
    if "--legacy-harness" not in sys.argv:
        sys.argv.append("--legacy-harness")
    module = __import__(PROGRAMMATIC_ENTRYPOINT, fromlist=["main"])
    if diagnostics:
        diagnostics.stage("entrypoint_invocation")
    module.main()


if __name__ == "__main__":
    main()
