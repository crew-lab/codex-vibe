**Concrete changes:**

Changed `.github/workflows/rollback.yml` in the `Download and verify prior release` step (lines 52-83):

1. **Local filenames**: Download from S3 keys `site.tar.gz` and `site.tar.gz.sha256` now saved locally as `garnebo-site-${RELEASE_SHA}.tar.gz` and `garnebo-site-${RELEASE_SHA}.tar.gz.sha256`
2. **Added strict checksum validation** before `shasum` and `tar`:
   - Exactly one LF-terminated line (`wc -l` equals 1)
   - No CRLF (`grep -q $'\r'` fails)
   - Line format: 64 lowercase hex digest + exactly two ASCII spaces + basename `garnebo-site-[a-f0-9]{40}.tar.gz` (regex)
   - Basename SHA extracted and verified to match the input `RELEASE_SHA`
3. **Extraction**: Uses the validated `garnebo-site-${RELEASE_SHA}.tar.gz` consistently

**Changed-file inventory:**
- `.github/workflows/rollback.yml` (single file modified)

**Unverified limitations:**
- Regex validation assumes `shasum -a 256` producer output format; non-standard checksum files will be rejected
- Validation relies on bash substring extraction and GNU grep `-E`; behavior on non-GNU systems is unverified
- Archive filename format `garnebo-site-<sha>.tar.gz` is hardcoded in validation regex; deviations from this exact pattern will fail
- No validation of the local filesystem path for the downloaded files (assumes working directory is safe)
