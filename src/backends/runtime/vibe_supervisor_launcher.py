"""Pinned Vibe runtime shim. This file runs inside the isolated child only."""
from __future__ import annotations

import inspect
import os
import re
import stat
import signal
import sys
import threading
import time
from typing import Any

EXPECTED_VERSION = "2.25.8"
# Set restrictive permissions before importing Vibe or creating its state.
os.umask(0o077)
ENTRYPOINTS = {
    "acp": "vibe.acp.entrypoint",
    "programmatic": "vibe.cli.entrypoint",
}
PROMPT_FILE_ENV = "VIBE_SUPERVISOR_PROMPT_FILE"
MAX_PROMPT_BYTES = 4 * 1024 * 1024
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
    # Suppress Vibe's info-level prompt logging. The isolated VIBE_HOME still
    # retains recovery messages after recursive reasoning/key redaction.
    os.environ["LOG_LEVEL"] = "ERROR"
    if "--legacy-harness" not in sys.argv:
        sys.argv.append("--legacy-harness")
    module = __import__(module_name, fromlist=["main"])
    module.main()


if __name__ == "__main__":
    main()
