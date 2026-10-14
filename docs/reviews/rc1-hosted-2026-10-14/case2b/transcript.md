**Concrete changes**

Modified `.github/workflows/rollback.yml` in the "Download and verify prior release" step:

- S3 source keys remain `site.tar.gz` and `site.tar.gz.sha256`
- Local downloads renamed to `garnebo-site-${RELEASE_SHA}.tar.gz` and `garnebo-site-${RELEASE_SHA}.tar.gz.sha256`
- Added strict pre-verification of the checksum file that rejects:
  - Incorrect file size (must be exactly 126 bytes)
  - Missing or wrong final LF (must be exactly one `0x0A`)
  - Any CR/CRLF characters
  - Malformed 64-char lowercase hex digest
  - Missing or extra spaces between digest and basename
  - Basename not matching `garnebo-site-${RELEASE_SHA}.tar.gz` exactly
- Updated `shasum -c` and `tar -xzf` to use the new local filenames

**Changed-file inventory**
- `.github/workflows/rollback.yml` (only file modified)

**Unverified limitations**
- Validation logic not executed in this environment; relies on bash, `grep -P`, `od`, `head`, `tail`, `wc` availability in GitHub Actions runner
- Assumes `${#EXPECTED_BASENAME}` equals 59 (12 + 40 + 7) since `release_sha` is pre-validated as 40 hex chars
