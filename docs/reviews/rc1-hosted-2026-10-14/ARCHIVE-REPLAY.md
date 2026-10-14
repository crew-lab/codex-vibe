# Archived verification inputs

The three retained `*.test.*.txt` files are byte-identical evidence inputs, not Supervisor repository test suites. Their suffix prevents automatic discovery by Vitest. Original recorded paths in historical JSON receipts are preserved. Their original SHA256 values are unchanged; current filenames are listed in SHA256-MANIFEST.json.

To replay the two Node helper suites, copy the case6 directory to a disposable verification directory, remove only the final .txt suffix from the two test filenames there, provide the repository-pinned MCP client dependency, and run node --test on those explicit files. The tests never launch hosted inference.

The TypeScript workflow verifier belongs to the separate Garnebo candidate harness and uses its existing YAML parser. Replay it in that reviewed disposable candidate with the original filename and dependencies, not inside the Supervisor runtime or worker worktree. Its logged 18-case outcomes remain historical acceptance evidence. No dependency is added to Supervisor to execute this archived cross-project input.
