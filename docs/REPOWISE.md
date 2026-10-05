# Using the Repowise MCP server

Repowise gives Claude Code codebase intelligence for one repository: an overview, change risk, the reasons behind past decisions, dead code, health and security checks. It is useful for answering "what will this change break?" before you open a PR.

## Add it to the project

Repowise is a hosted HTTP MCP server scoped to one repo by its URL. This project's URL is:

```
https://api.repowise.dev/mcp/ArtistaVeKaras/claude-code--todoapp
```

1. Get an API key from your Repowise account and store it in an environment variable. The key never goes into a file:

   ```powershell
   [Environment]::SetEnvironmentVariable('REPOWISE_API_KEY', '<your-key>', 'User')
   ```

   Open a new terminal afterwards so the variable is visible.

2. Add the server with project scope, which writes `.mcp.json` at the repo root:

   ```bash
   claude mcp add --transport http --scope project repowise \
     https://api.repowise.dev/mcp/ArtistaVeKaras/claude-code--todoapp \
     --header "Authorization: Bearer ${REPOWISE_API_KEY}"
   ```

   In PowerShell 5.1 the quoting is fragile. If the command mangles the header, edit `.mcp.json` by hand instead:

   ```json
   "repowise": {
     "type": "http",
     "url": "https://api.repowise.dev/mcp/ArtistaVeKaras/claude-code--todoapp",
     "headers": { "Authorization": "Bearer ${REPOWISE_API_KEY}" }
   }
   ```

3. Check it:

   ```bash
   claude mcp get repowise      # should show: Status: Connected
   ```

   Then start a new Claude Code session (or run `/mcp`) so the tools load. Claude Code asks you to approve a project-scoped server the first time.

`.mcp.json` only contains `${REPOWISE_API_KEY}`, not the key, so it is safe to commit. Teammates add their own key to their own environment.

## The tools

All of them read only.

| Tool | Use it to |
| --- | --- |
| `get_overview` | Orient: structure and main areas of the repo. Start here. |
| `get_context` | Get context for a file or area before editing it. |
| `get_symbol` | Find a function's signature, line range and callers/callees. It never returns the body, so read the file for that. |
| `search_codebase` | Search the codebase by concept or name. |
| `get_answer` | Ask a question in plain words. Check `confidence`: on `low`, read the `fallback_targets` it names. |
| `get_why` | Find the decisions and history behind a file or choice. |
| `get_risk` / `get_change_risk` | Judge how risky a file or a planned change is. |
| `get_dead_code` | Find code nothing uses. |
| `get_health` | See code health for the repo. |
| `get_security` | See security findings. |

You don't call these yourself. Ask in plain words, or name Repowise ("use repowise") to make sure it is used.

## Example prompts

> Use repowise to give me an overview of this repo.

> Use repowise get_symbol on `render` in app.js. What calls it?

> Before I change how tasks are saved, use repowise get_change_risk on `save()` in app.js.

> Use repowise get_why on i18n.js. Why must it load before app.js?

> Use repowise get_dead_code. Is anything in styles.css or app.js unused?

> Use repowise get_security and tell me if the localStorage handling has any issues.

## Read the `_meta` block

Every response says which commit it describes. Check it before trusting the answer:

- `indexed_commit` is the commit that was indexed. Compare it with `git rev-parse HEAD`. Repowise can't see your checkout, so it won't tell you it is behind.
- `stale_warning` means a re-index is recommended.
- `state.degraded` means part of the index failed to load, so an empty result is a failed read, not an empty repo.
- An empty `callers` or `callees` carries a `*_basis` saying how much the graph resolved. Read it before concluding nothing calls a symbol.

Changes on your branch that aren't pushed and re-indexed won't show up in answers.

## Create a PR

Use Repowise to check the change, then open the PR with `gh`.

1. **Check the risk first.**

   > Use repowise get_change_risk for my changes in app.js and i18n.js.

2. **Branch off `main`.** Don't commit to `main`.

   ```bash
   git switch main && git pull
   git switch -c feat/short-description
   ```

3. **Commit and push.** Stage only the files you changed. Don't use `git add .`, which could pick up `.playwright-mcp/` or other local files.

   ```bash
   git add app.js i18n.js
   git commit -m "Add short description of the change"
   git push -u origin feat/short-description
   ```

4. **Write the PR body to a file.** PowerShell 5.1 mangles double quotes in native arguments, so use `--body-file`:

   ```powershell
   @'
   ## Summary
   - What changed and why

   ## Repowise check
   - get_change_risk on app.js: <result>
   - indexed_commit matched HEAD: yes/no

   ## Test plan
   - [ ] Open the app, add, complete and delete a task
   '@ | Set-Content pr-body.md -Encoding utf8

   gh pr create --base main --title "Add short description" --body-file pr-body.md
   Remove-Item pr-body.md
   ```

5. **Or ask Claude Code to do all of it:**

   > Use repowise get_change_risk on my changes, then create a branch, commit, push and open a PR to main. Put the risk result in the PR description.

Keep the PR small. One change per PR makes the risk result easier to read.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `repowise` shows as failed or 401 | `REPOWISE_API_KEY` is missing or wrong in the environment that started Claude Code. Set it, open a new terminal and start a new session. |
| Tools don't appear | Run `/mcp`, approve the project server, then reconnect it. |
| `gh: command not found` | Refresh PATH: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')` |
| Answers describe old code | Compare `indexed_commit` with `git rev-parse HEAD` and re-index in Repowise. |
| Remove it | `claude mcp remove repowise -s project` |
