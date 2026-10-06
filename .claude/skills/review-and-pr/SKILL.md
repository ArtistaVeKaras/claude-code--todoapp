---
name: review-and-pr
description: Review code changes for bugs and quality (with configurable effort level), check Repowise change risk, then create a PR with findings. Use this whenever the user has changes ready and wants to review them before opening a PR — just ask to "review and create PR" or "review my changes and PR them".
---

# Review Code and Create PR

Automates the complete PR workflow: review your changes, analyze impact with Repowise, then open a PR with review findings in the description.

## Pre-flight

- Branch off `main` (don't commit to main)
- Make your changes and stage them, or leave them unstaged
- Repowise MCP is optional; if configured, it'll be included in risk analysis

## Steps

1. **Code Review.** Run `/code-review` at the effort level you choose:
   - `low` — quick scan for obvious bugs
   - `medium` — (default) bugs and simplification opportunities
   - `high` — broader coverage, may include uncertain findings
   - `max` — deep review with multi-agent analysis

2. **Change Risk** (if Repowise is configured). Call `get_change_risk` on the files you changed to surface impact.

3. **Create PR.** Call `/create-pr` to branch, commit, push, and open the PR to `main` with review findings in the description.

## Usage

```
/review-and-pr
```

Then tell me:
- The effort level for code review (or "medium" for default)
- PR title and any context you'd like in the description

Or in one go:
> Review my changes at high effort, check risk with Repowise, and create a PR to main titled "Add task filtering"

## What gets staged

The skill stages only the files you changed. If you have uncommitted files mixed with staged ones:
- Staged files are included in the review and PR
- Unstaged changes stay unstaged (not included unless you stage them)

Run `git status` before the skill starts if you want to confirm what's going in.

## After the PR is created

The skill reports:
- PR URL and branch name
- Files included
- Any review findings in the PR description

You're done — merging is your decision.

## Customization

Want to skip Repowise even though it's configured? Tell me "review and PR without risk analysis".

Want to fix issues before PRing? Make changes, stage them, and run the skill again.

## Rules

- Uses Bash for all git and `gh` commands (required by the `create-pr` skill)
- Never force-pushes, resets hard, or merges — those are your calls
- Stages only files you explicitly include
- No `--no-verify` or signing bypasses
