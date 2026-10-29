# Private-artifact preflight recovery — 2026-10-28

The coordinator corrected an owned patch from mode 0644 to 0600 without changing its bytes; actual copy-only preflight then passed. The original stopped preflight is retained. The two authorized hosted starts were used once each: review accepted independently, edit rejected because its generated tests call an unimported test identifier. The exact original patch and checks are preserved. Adding the missing node:test import in a separate coordinator copy makes five tests pass and catches the original boundary defect. Coordinator work is not Vibe success.

See RECOVERY.md for outcomes, scope and attribution; the adjacent logs preserve the failed worker tests and the separate coordinator tests/mutation control. Original supervisor configuration was restored exactly after a concurrency check, both runs are closed and the active slot is free. No artifact policy, installed candidate, project source or publication changed.

Only skill/documentation guidance changed in this recovery; previous local source and release-verification evidence remains historical. This packet does not claim accepted worker output or a newly qualified archive.
