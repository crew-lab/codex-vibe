"""No-network regression fixture for the pinned Vibe session persistence shim."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location("vibe_supervisor_launcher", HERE / "vibe_supervisor_launcher.py")
assert SPEC and SPEC.loader
LAUNCHER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LAUNCHER)


class SessionPersistenceRedactionTest(unittest.TestCase):
    def test_real_installed_logger_writes_redacted_recovery_data(self) -> None:
        os.environ["MISTRAL_API_KEY"] = "fixture-secret-canary"
        from vibe.core.session.session_logger import SessionLogger

        LAUNCHER._patch_session_logger()
        message = {
            "role": "assistant",
            "content": "public reply",
            "reasoning_content": "hidden thought canary",
            "reasoning_payloads": [{"text": "second thought canary"}],
            "metadata": {"thought_process": "third thought canary", "api_key": "fixture-secret-canary", "session_id": "fixture-session"},
        }
        metadata = {"session_id": "fixture-session", "context_size": 321, "provider_access_token": "fixture-secret-canary", "summary": "public metadata"}
        with tempfile.TemporaryDirectory(prefix="vibe-shim-fixture-") as temp:
            directory = Path(temp)
            SessionLogger._persist_messages_sync([message], directory)
            SessionLogger._overwrite_messages_sync([message], directory)
            SessionLogger._persist_metadata_sync(metadata, directory)
            messages = (directory / "messages.jsonl").read_text(encoding="utf-8")
            saved_meta = (directory / "meta.json").read_text(encoding="utf-8")
            for forbidden in ("hidden thought canary", "second thought canary", "third thought canary", "fixture-secret-canary", "reasoning_content", "reasoning_payloads", "thought_process"):
                self.assertNotIn(forbidden, messages + saved_meta)
            saved_message = json.loads(messages.strip().splitlines()[-1])
            parsed_meta = json.loads(saved_meta)
            self.assertEqual(saved_message["content"], "public reply")
            self.assertEqual(saved_message["metadata"]["session_id"], "fixture-session")
            self.assertEqual(parsed_meta["context_size"], 321)
            self.assertEqual(parsed_meta["summary"], "public metadata")


if __name__ == "__main__":
    unittest.main()
