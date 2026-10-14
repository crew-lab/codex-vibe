# Official-client active-disconnect case 6

Preparation only. No hosted worker was started. The runner refuses to connect or start a run unless `--execute` is supplied. It uses the official MCP `Client` and `StdioClientTransport`, checks negotiated server version 1.0.1-rc.1 and the exact five-tool catalog, and checks policy revision `1b44e421b46ad2443563e8b5625f1ad4859870bfe02397fcb86acbeb41db3966`. The observer is armed before the single start. Before closing the client, the runner requires run status `running`, the Vibe `entrypoint_invocation` diagnostic, a completed `read_file`, and a fresh (at most one second old) observer sample for the same run showing an owned descendant alive. After disconnect it polls for a coherent observer sample showing the supervisor gone, lock absent, all owned process groups empty, and the saved run failed. It does not save the receipt, transcript, tool arguments/results, provider traffic, reasoning or stderr. It never calls `vibe_close`.

Prepared one-start command (not run):

The current runner's pre-close gate is stricter than the short description above: it requires a completed `read_file` call and an external observer sample for this run showing an owned descendant alive while run state is `running`.

```sh
/Users/roman/.nvm/versions/node/v24.21.0/bin/node \
  /Users/roman/src/github.com/crew-lab/codex-vibe/tmp/rc1-hosted-acceptance/official-disconnect/official-disconnect.mjs \
  --execute \
  --cli /Users/roman/.local/share/vibe-supervisor/1.0.1-rc.1/node_modules/vibe-supervisor/dist/cli.js \
  --config /Users/roman/.local/share/vibe-supervisor/rc20-config/config.toml \
  --workspace /Users/roman/src/github.com/crew-lab/codex-vibe/tmp/v1-native-fixture/rc22-disconnect-fixture \
  --base-ref 9e04d00353b368d84bfbd529d51333ef40ae2b83 \
  --task-file /Users/roman/src/github.com/crew-lab/codex-vibe/tmp/rc1-hosted-acceptance/official-disconnect/case6-task.txt \
  --output /Users/roman/src/github.com/crew-lab/codex-vibe/tmp/rc1-hosted-acceptance/official-disconnect/case6-official-client.json \
  --observer-output /Users/roman/src/github.com/crew-lab/codex-vibe/tmp/rc1-hosted-acceptance/official-disconnect/case6-observer.jsonl
```

The output paths must be new. The assigned source is the clean frozen fixture at `9e04d00353b368d84bfbd529d51333ef40ae2b83`, with the exact 11-file task in `case6-task.txt`. The case limit is 12 turns, 180 seconds, one start, no retry. If the run settles before the active-worker metadata gate, the recorded outcome is inconclusive and the runner performs ordinary client cleanup without claiming a disconnect. A successful disconnect leaves the supervisor-owned edit worktree retained for the parent to inspect and close under the existing saved-export cleanup contract.
