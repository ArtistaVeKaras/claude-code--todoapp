---
name: rtk
description: Uses RTK (Rust Token Killer), a CLI proxy that compresses command output to save tokens. Use whenever running git, gh, ls, grep, tests, linters, builds, docker or package commands, when output is noisy or long, or when the user asks about token savings or `rtk gain`. Do not compress logs that need debugging; read those in full.
---

# RTK: token-saving command output

RTK (https://github.com/rtk-ai/rtk) wraps common commands and returns only the useful part: grouped, deduplicated, failures first. Typical savings on bash output are 60-90%.

Installed with `winget install rtk-ai.rtk` (v0.50.0). Verify with `rtk --version` and `rtk gain`. If `rtk gain` fails, the wrong "rtk" (Rust Type Kit) is on PATH.

## How it runs

- **With the hook** (`rtk init -g`, then restart Claude Code): Bash commands are rewritten automatically, so `git status` runs as `rtk git status`. Nothing to do.
- **Without the hook**: prefix read-only commands with `rtk` yourself. If `rtk` is not installed, run the plain command.
- **Never hand-prefix `git` or `gh` commands that change things** (`commit`, `push`, `reset`, `pr create`, `pr merge`). The repo's allow/deny rules in `.claude/settings.json` match `git ...` and `gh ...`, so `rtk git reset --hard` or `rtk gh pr merge` would slip past them and `rtk git commit` would prompt. Run the plain command and let the hook compress it.
- The hook only covers the **Bash** tool. Built-in Read, Grep and Glob are not rewritten. For large files or wide searches, use `rtk read`, `rtk grep`, `rtk find` via Bash.

## Examples

| Instead of | Use | Effect |
|---|---|---|
| `git status` | `rtk git status` | compact status |
| `git log -n 10` | `rtk git log -n 10` | one line per commit |
| `git diff` | `rtk git diff` | condensed diff |
| `ls -la` | `rtk ls .` | compact tree |
| `cat big.js` | `rtk read big.js -l aggressive` | signatures only |
| `grep -rn foo .` | `rtk grep "foo" .` | results grouped by file |
| `gh pr list` | `rtk gh pr list` | compact table (read-only only) |
| `npm test` / `pytest` / `jest` | `rtk jest` / `rtk pytest` | failures only |
| `tsc`, `eslint`, `ruff check` | `rtk tsc`, `rtk lint`, `rtk ruff check` | grouped errors |
| `docker ps` | `rtk docker ps` | compact list |
| any noisy command | `rtk err <cmd>` | errors only |
| any test command | `rtk test <cmd>` | failures only |

Typical flow in this repo:

```bash
rtk git status
rtk git diff
rtk gh pr list
git commit -m "Fix todo filter"   # plain; the hook compresses it to "ok 1a2b3c4"
```

## Analytics

- `rtk gain`: total tokens saved
- `rtk gain --graph`: savings over time
- `rtk discover`: commands that ran without RTK and could have been compressed

## Debugging: do not compress important logs

When a log is needed to diagnose a problem, read it in full. Compression drops repeated lines, timestamps, stack frames and context that can be the clue. This rule takes precedence over the global `~/.claude/RTK.md`, which only asks for a rerun when output is unusable: for debugging, go uncompressed from the first run.

Run these with `rtk proxy <cmd>`. A plain command is not enough, because the hook rewrites it into a compressed `rtk` call. Do not use `rtk err`, `rtk test`, `rtk summary` or `rtk read -l aggressive` for them:

- Failing tests or builds you are investigating
- Stack traces, crash dumps and error logs (application, server, browser console, CI)
- Anything the user says to debug, investigate, trace or find the root cause of
- Logs where ordering, timing, repetition or exact wording matters (race conditions, flaky tests, retries)

Rules:

- Run the uncompressed command first. A flaky failure may not reproduce on a rerun, and the original log would be lost.
- If you already ran a compressed command and its output is empty, vague or does not explain the failure, rerun it with `rtk proxy` before guessing.
- For very large logs, narrow the source instead of compressing it, so the lines you keep stay verbatim. In PowerShell use `Get-Content app.log -Tail 200` or `Select-String "ERROR" app.log`; in Bash use `tail -n 200 app.log`.
- Go back to RTK once the debugging is done.

## Need the raw output

Use `rtk proxy <cmd>` for unfiltered passthrough (still tracked). Running the command without the `rtk` prefix does not bypass the hook.

## Windows caveats

- `rtk run`, `rtk err`, `rtk test`, `rtk summary` do not expand globs, variables or operators (`&&`, `|`). Pass a shell: `rtk run -c 'dir'` or `rtk err --shell cmd '...'`.
- cmd builtins (`dir`, `echo`) need `-c` / `--shell cmd`.
- Install ripgrep (`rg`) to avoid "Binary 'rg' not found" warnings.
- In the `create-pr` workflow, keep each command a simple command. Chained commands match no allow rule.

## Notes

- Token counts are estimates (bytes/4). Trust percentages over absolute numbers.
- Savings apply to bash output only, not prompts or model output.
- Telemetry is off by default. Check with `rtk telemetry status`.
- Remove the hook with `rtk init -g --uninstall`.
