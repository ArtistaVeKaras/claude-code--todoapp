---
name: create-pr
description: Branches off main, commits the intended changes, pushes, and opens a pull request with gh. Use whenever the user asks to create, open or raise a PR, or says "commit and PR this".
---

# Create a pull request

The user has pre-approved this whole workflow, so do not ask "should I commit/push/open the PR?" once they have asked for a PR. Ask only if something below says to stop.

## Rules

- Run each step as its **own simple command**. Never chain commit, push and `gh pr create` into one call, and never use `;`, `&&` or pipes to join them. `.claude/settings.json` allows these commands one by one; a compound command matches no rule and gets denied.
- Use the **Bash** tool (Git Bash, the primary shell for this workflow), not PowerShell, with POSIX syntax and forward-slash paths. Use command forms that match the allow rules in `.claude/settings.json`: `git add`, `git commit`, `git switch`, `git push -u origin <branch>`, `gh pr create`.
- Never push to `main`/`master`, force-push, `git reset --hard`, or `gh pr merge`. These are denied. Merging is the user's decision.
- Stage **named files only**. Never `git add .` or `-A`. Leave out `.mcp.json`, `.claude/settings.local.json`, `.playwright-mcp/` and anything the user did not ask to include, unless they say so.
- Never use `--no-verify` or skip signing.

## Steps

1. **Inspect.** `git status --short -b`, then `git diff --stat` (and `git diff --cached --stat` if files are staged). Work out which files belong in this PR.

2. **Branch.** If on `main`, or on a branch unrelated to this change:
   - `git switch main`
   - `git pull --ff-only`
   - `git switch -c <type>/<short-kebab-description>` where type is `feat`, `fix`, `docs` or `chore`.

   Uncommitted files carry over when you switch. If already on a suitable feature branch, stay on it.

3. **Stage.** `git add <file1> <file2>`, then `git status --short` to confirm only the intended files are staged.

4. **Commit.** One short imperative summary line, matching earlier commits (`git log --oneline -5`), plus the attribution line from the session. Write the message to a file in the scratchpad directory with the Write tool (no heredocs or `$(...)`, which can make the command compound), then commit from it:

   ```text
   Add short description

   Co-Authored-By: <attribution line from the session>
   ```

   ```bash
   git commit -F <scratchpad>/commit-msg.txt
   ```

5. **Push.** `git push -u origin <branch>`.

6. **Write the PR body with the Write tool**, to a file in the scratchpad directory (for example `<scratchpad>/pr-body.md`). Never pass a multi-line body inline; quoting and `$(...)` make the command compound. Use this shape, and end with the PR attribution line from the session:

   ```markdown
   ## Summary
   - What changed and why

   ## Notes
   - Anything left out on purpose, such as untracked files

   ## Test plan
   - [ ] How to check it
   ```

7. **Open the PR.** `gh pr create --base main --title "<title>" --body-file <path to pr-body.md>`

   If `gh` is not found, run `command -v gh` as its own command. Git Bash inherits PATH from the process that started Claude Code, so a `gh` installed after that is missing. Tell the user to open a new terminal and restart Claude Code. Do not install anything or change PATH inline.

8. **Report** the PR URL, the branch, the files included, and anything deliberately left out. Do not merge.

## If a command is denied

Do not retry the same command or work around it with a wrapper. Say which command was denied and which rule in `.claude/settings.json` it hit (or missed), then continue with the remaining safe steps or ask the user.
