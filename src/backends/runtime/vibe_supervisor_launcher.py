"""Pinned Vibe runtime shim. This file runs inside the isolated child only."""
from __future__ import annotations

import atexit
import inspect
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

EXPECTED_VERSION = "2.25.8"
# Set restrictive permissions before importing Vibe or creating its state.
os.umask(0o077)
ENTRYPOINTS = {
    "acp": "vibe.acp.entrypoint",
    "programmatic": "vibe.cli.entrypoint",
}
PROMPT_FILE_ENV = "VIBE_SUPERVISOR_PROMPT_FILE"
MAX_PROMPT_BYTES = 4 * 1024 * 1024
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


def trusted_original_home(raw: Optional[str]) -> Optional[str]:
    if not raw or "\0" in raw or not os.path.isabs(raw) or os.path.normpath(raw) != raw:
        return None
    try:
        info = os.lstat(raw)
    except OSError:
        return None
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        return None
    return raw


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


def lookup_keychain_credential(home: str, runner: Runner = _run_bounded, executable: str = SECURITY_BINARY) -> "tuple[Optional[str], str]":
    environment = {"HOME": home, "PATH": SECURITY_PATH}
    reason = "not-found"
    for service in KEYCHAIN_SERVICES:
        argv = [executable, "find-generic-password", "-a", CREDENTIAL_ENV, "-s", service, "-w"]
        try:
            code, output = runner(argv, environment, KEYCHAIN_TIMEOUT_SECONDS, MAX_KEYCHAIN_OUTPUT_BYTES)
        except TimeoutError:
            reason = "timeout"
            continue
        except OverflowError:
            reason = "oversize"
            continue
        except Exception:
            reason = "error"
            continue
        if code != 0:
            reason = "not-found"
            continue
        credential = _decode_credential(output)
        if credential is None:
            reason = "invalid-output"
            continue
        return credential, "found"
    return None, reason


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
    home = trusted_original_home(original_home)
    if home is None:
        return "skipped-home"
    credential, reason = lookup_keychain_credential(home, runner, executable)
    if credential is None:
        return reason
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


def _start_parent_watchdog() -> None:
    parent_pid = os.getppid()
    try:
        timeout = max(1, int(os.environ.get("VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS", "2400")))
    except ValueError as exc:
        raise RuntimeError("Invalid VIBE_SUPERVISOR_WORKER_TIMEOUT_SECONDS") from exc
    started = time.monotonic()

    def terminate_own_group() -> None:
        pgid = os.getpgrp()
        # launcher's Node parent creates a detached process group. Never use a
        # guessed/stored child PID, and never signal an inherited interactive group.
        if pgid != os.getpid():
            os.kill(os.getpid(), signal.SIGKILL)
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def monitor() -> None:
        while True:
            time.sleep(1)
            if os.getppid() != parent_pid or time.monotonic() - started >= timeout:
                terminate_own_group()
                return

    threading.Thread(target=monitor, name="vibe-supervisor-parent-watchdog", daemon=True).start()


def main() -> None:
    original_home = os.environ.pop(ORIGINAL_HOME_ENV, None)
    _start_parent_watchdog()
    import vibe

    if vibe.__version__ != EXPECTED_VERSION:
        raise SystemExit(f"Vibe privacy shim supports exactly {EXPECTED_VERSION}; found {vibe.__version__}")
    kind = os.environ.get("VIBE_SUPERVISOR_ENTRYPOINT", "")
    module_name = ENTRYPOINTS.get(kind)
    if module_name is None:
        raise SystemExit("VIBE_SUPERVISOR_ENTRYPOINT must be 'acp' or 'programmatic'")
    if kind == "programmatic":
        sys.argv = consume_prompt_file(os.environ, sys.argv, os.path.dirname(os.path.realpath(__file__)))
    elif os.environ.pop(PROMPT_FILE_ENV, None) is not None:
        raise SystemExit("A prompt file is only valid for the programmatic entrypoint")
    _patch_session_logger()
    status = resolve_credential(os.environ, original_home)
    if status == "keychain":
        _install_stderr_redaction(os.environ[CREDENTIAL_ENV])
    elif status not in ("environment", "skipped-platform"):
        sys.stderr.write(f"vibe-supervisor: no Keychain credential resolved ({status}); Vibe will use its own authentication\n")
    # Suppress Vibe's info-level prompt logging. The isolated VIBE_HOME still
    # retains recovery messages after recursive reasoning/key redaction.
    os.environ["LOG_LEVEL"] = "ERROR"
    if "--legacy-harness" not in sys.argv:
        sys.argv.append("--legacy-harness")
    module = __import__(module_name, fromlist=["main"])
    module.main()


if __name__ == "__main__":
    main()
