# dsh-turnsnap

Zero-config per-turn git checkpoints for [DeepSeek Harness (DSH)](https://github.com/search?q=deepseek+harness). After every completed agent turn, if the session's working directory is a git repository with uncommitted changes, TurnSnap stages everything and creates one tagged `[turnsnap]` commit — a rollback point you never had to ask for.

[中文说明](./README.zh.md)

## Why

Long agent sessions rewrite many files. When a turn goes wrong you either reach for `git` by hand or lose the trail. TurnSnap makes the checkpoint automatic: one commit per turn, named after the turn number, file count and time:

```
[turnsnap] turn 12 · 7 files · 14:32:08
```

## Install

```sh
dsh plugin --profile <your-profile> add dsh-turnsnap
```

No configuration, no client half, nothing to approve: the host half hot-reloads within seconds and starts guarding every session in a git workspace.

## How it works

- Listens to the harness `agent/turn-stopping` event.
- Resolves the session workspace from `agent.session.header.cwd`.
- Skips silently when the directory is not a git repository or has a clean tree.
- Otherwise runs `git add -A && git commit -m "[turnsnap] turn N · M files · HH:MM:SS" --no-verify`.
- Checkpoints are serialized on one internal queue, so a parent session and its subagents closing turns at the same moment cannot race the git index.
- Git runs through the harness shell service; when the host exposes a sandbox-policy resolver, each request is stamped with the owning session's standing file policy.

## Agent tools

| Tool | Effect |
| --- | --- |
| `turnsnap_pause` | Stop auto-commits until resumed |
| `turnsnap_resume` | Resume auto-commits |
| `turnsnap_status` | Report enabled state, counters and the last checkpoint message |

All three take no arguments. Ask the model to "pause turnsnap" mid-session, or call them yourself from any script that can invoke harness tools.

## Caveats

- `git add -A` folds anything staged-but-uncommitted into the checkpoint. If you keep a deliberate partial stage across a turn boundary, pause first.
- Ignored files stay ignored (`add -A` respects `.gitignore`).
- Commits use `--no-verify`, so your pre-commit hooks do not run on checkpoints.
- One checkpoint per repository per turn: subagents sharing the workspace land in the same commit.

## License

MIT
