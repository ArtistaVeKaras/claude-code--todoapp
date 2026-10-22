# Subagent plan

This repo ships eight Claude Code subagents in [`.claude/agents/`](../.claude/agents/). Each one does a single job in the development workflow, works in its own
context, and follows this project's rules: no packages, no build step, plain CSS, five languages, two modes (local and account), and the server's security
table.

This page explains what each subagent does, why it exists, and the order to call them in.

## The workflow at a glance

```
  1. PLAN          2. BUILD                    3. VERIFY                     4. SHIP
┌──────────┐   ┌──────────────────┐   ┌──────────────────────┐   ┌───────────────────────┐
│ planner  │──▶│ server-builder   │──▶│ test-writer          │──▶│ docs-keeper           │
│          │   │ frontend-builder │   │ security-auditor  ┐  │   │ /review-and-pr        │
│          │   │ i18n-keeper      │   │ a11y-auditor      ┘  │   │   or /create-pr       │
└──────────┘   └──────────────────┘   └──────────────────────┘   └───────────────────────┘
                        ▲                        │
                        └──── fix findings ──────┘
```

The two auditors are read-only and independent, so they can run at the same time. If either finds problems, go back to the right builder, then run `test-writer`
and the auditor again.

## The subagents

| # | Subagent | Phase | Edits files? | Model | Purpose in one line |
| --- | --- | --- | --- | --- | --- |
| 1 | `planner` | Plan | No | opus | Turns a request into a file-by-file plan that respects the project's rules |
| 2 | `server-builder` | Build | Yes | sonnet | Changes the Node accounts server in `server/` |
| 3 | `frontend-builder` | Build | Yes | sonnet | Changes `index.html`, `app.js` and `styles.css` |
| 4 | `i18n-keeper` | Build | Yes | sonnet | Keeps every key in all five languages in `i18n.js` |
| 5 | `test-writer` | Verify | Yes (tests only) | sonnet | Writes and runs `node --test` tests |
| 6 | `security-auditor` | Verify | No | opus | Reviews the change against the threat table |
| 7 | `a11y-auditor` | Verify | No | sonnet | Reviews the change against WCAG 2.1 AA |
| 8 | `docs-keeper` | Ship | Yes (docs only) | sonnet | Brings README, developer docs and skills in line with the code |

`opus` is used where judgement matters most (scoping a change, finding security holes). The rest use `sonnet`, which is faster and cheaper for well-scoped work.

### 1. `planner`

- **What it does:** reads `README.md` and `docs/DEVELOPER.md`, then writes a plan: goal, files and functions to change, behavior in both modes, tests to add,
  docs to update, which subagents to run next, and open questions.
- **Purpose:** catches problems before any code exists. Examples: a feature that only works in account mode, a string with no translations, or an idea that
  needs an npm package. It has no edit tools, so it cannot start coding early.
- **When to call:** first, for anything that touches more than one file or both the page and the server. Skip it for a one-line fix.

### 2. `server-builder`

- **What it does:** implements routes, schema, sessions, rate limits and mail in `server/` using only built-in Node modules.
- **Purpose:** keeps the security guarantees intact while the API grows. Every write route stays JSON-only and origin-checked. Todo queries stay scoped to the
  signed-in user, only token hashes are stored, and time comes from the injected `now()` so tests can use a fake clock.
- **When to call:** after `planner`, **before** `frontend-builder` when a feature needs both. The page needs the API to exist first. It reports any new error
  codes for `i18n-keeper`.

### 3. `frontend-builder`

- **What it does:** implements page changes in plain HTML, CSS and JavaScript. It follows the app's flow (change state, save, `render()`), builds the DOM with
  `textContent`, uses the CSS variables for both themes, and respects the Content-Security-Policy.
- **Purpose:** keeps the no-build, no-dependency front end consistent and safe, and makes sure each feature works in both local and account mode.
- **When to call:** after `planner` (and after `server-builder` if there is an API change). It reports any new translation keys.

### 4. `i18n-keeper`

- **What it does:** adds or updates keys in every language block of `i18n.js` (`en`, `fr`, `pt`, `es`, `pl`), including plural functions such as `itemsLeft`,
  and adds new languages.
- **Purpose:** `t()` does not fall back to English for a single missing key, so a missing translation shows as blank text. This agent keeps
  `tests/translations.test.js` passing and the translations natural.
- **When to call:** right after a builder reports new or reworded text, or on its own to add a language.

### 5. `test-writer`

- **What it does:** adds tests to the right file in `tests/` with `node:test`, the helpers, an in-memory database and the fake clock. For each new route it
  covers the happy path, signed out, another user's data, cross-site requests and bad input. For a bug, it writes the failing test first.
- **Purpose:** proves the change works and stays working. It never changes app code to make a test pass.
- **When to call:** after the build phase. For a bug fix, call it **first** to reproduce the bug, then call the builder.

### 6. `security-auditor`

- **What it does:** reads the diff and checks it against the security table in `docs/DEVELOPER.md`: XSS, CSRF, access control, sessions, secrets, account
  enumeration, rate limits, the clock, input limits and dependencies. Findings come back ranked and marked Confirmed or Possible.
- **Purpose:** an independent second look by an agent that did not write the code. Read-only, so it cannot "fix" things silently.
- **When to call:** after `test-writer`, for any change to `server/`, to auth screens, or to how `app.js` puts data on the page. Run it in parallel with
  `a11y-auditor`.

### 7. `a11y-auditor`

- **What it does:** reads the diff and checks labels, keyboard access, focus, announcements, contrast in both themes (computed from the CSS variables), target
  size, zoom, reduced motion and `<html lang>`.
- **Purpose:** keeps the WCAG 2.1 AA work from PR #22 from slipping as the UI changes.
- **When to call:** after `test-writer`, for any change to `index.html`, `styles.css` or the DOM that `app.js` builds. Run it in parallel with
  `security-auditor`.

### 8. `docs-keeper`

- **What it does:** updates `README.md`, the matching sections of `docs/DEVELOPER.md` (API, settings, security and tests tables, known limitations) and any
  `.claude/skills/*/SKILL.md` affected by the change. It flags diagrams in `docs/diagrams/` that are now wrong rather than redrawing them.
- **Purpose:** the docs here are detailed and other agents rely on them, so stale docs cause wrong plans later.
- **When to call:** last, once code and tests are final and the audits are clean. Then open the PR.

## How to call a subagent

Ask Claude Code in plain words, naming the subagent, for example: *"Use the planner subagent to plan task editing."*

### Tips for calling them well

- **Name the subagent.** Claude Code can pick one on its own from its description, but naming it makes sure the right one runs. To force it, type `@` and pick
  the agent from the list (for example `@agent-planner`).
- **Say what you want back, not only what to do.** A subagent starts with a fresh context and cannot see your chat. Give it the goal, the files or area, and any
  limits: *"Use the planner subagent to plan task editing. Double-click a task to edit its text, Enter saves, Escape cancels. It must work in local and account
  mode."*
- **Pass the previous report along.** Each subagent ends with a report, and the next one only knows what you hand it: *"Use the i18n-keeper subagent to add the
  keys frontend-builder just reported: `editTask`, `editTaskHint`."*
- **Point builders at the plan.** *"Use the frontend-builder subagent to implement steps 3 to 5 of the plan above."* This keeps them from redesigning the
  feature.
- **Chain steps in one prompt** when you trust the order: *"Use server-builder, then frontend-builder, then i18n-keeper to build the plan above. Stop if npm
  test fails."*
- **Run the auditors together.** They only read, so ask for both at once: *"Run the security-auditor and a11y-auditor subagents in parallel on the changes
  against main."*
- **Give auditors a scope.** "The current diff", "changes against main" or "`server/app.js`" gets a focused review; "check the app" gets a vague one.
- **For a bug, start with a failing test:** *"Use the test-writer subagent to write a failing test that shows completed todos come back after sign-out. Don't
  fix it."*
- **Send findings to a builder, not back to the auditor.** Auditors cannot edit files: *"Use the frontend-builder subagent to fix findings 1 and 3 from the
  a11y-auditor report."*
- **Read the report before the next step.** Answer the planner's open questions and check the builder's test results before moving on. A short report is the
  handoff, so a wrong one carries forward.
- **One job per call.** "Plan and build task editing" mixes phases; split it so each agent stays in its lane.
- Run `/agents` to list the subagents and check their descriptions.

### Prompts to copy

| Subagent | Example prompt |
| --- | --- |
| `planner` | *"Use the planner subagent to plan due dates on tasks. Tell me which subagents to run next."* |
| `server-builder` | *"Use the server-builder subagent to add the route for editing a task's text, as in the plan above."* |
| `frontend-builder` | *"Use the frontend-builder subagent to add inline editing to each task, following the plan above."* |
| `i18n-keeper` | *"Use the i18n-keeper subagent to add German (`de`) to i18n.js."* |
| `test-writer` | *"Use the test-writer subagent to cover the new edit route: signed out, another user's todo, cross-site request and empty text."* |
| `security-auditor` | *"Use the security-auditor subagent to review the changes against main."* |
| `a11y-auditor` | *"Use the a11y-auditor subagent to check the new edit field in both themes."* |
| `docs-keeper` | *"Use the docs-keeper subagent to update README and DEVELOPER.md for task editing."* |

## Sequences for common jobs

| Job | Sequence |
| --- | --- |
| **Full-stack feature** (for example, edit a task's text) | `planner` → `server-builder` → `frontend-builder` → `i18n-keeper` → `test-writer` → `security-auditor` + `a11y-auditor` → `docs-keeper` → `/review-and-pr` |
| **Page-only feature** (for example, remember the filter) | `planner` → `frontend-builder` → `i18n-keeper` → `test-writer` → `a11y-auditor` → `docs-keeper` → `/create-pr` |
| **Server-only change** (for example, a screen-less API route) | `planner` → `server-builder` → `test-writer` → `security-auditor` → `docs-keeper` → `/review-and-pr` |
| **Bug fix** | `test-writer` (failing test) → `server-builder` or `frontend-builder` → `test-writer` (passes) → the auditor for that area → `/create-pr` |
| **New language** | `i18n-keeper` → `a11y-auditor` (longer strings, `lang`) → `docs-keeper` → `/create-pr` |
| **Styling or theme change** | `frontend-builder` → `a11y-auditor` → `/create-pr` |
| **Pre-release check** | `security-auditor` + `a11y-auditor` on `main`, then `docs-keeper` to fix drift |
| **Docs only** | `docs-keeper` → `/create-pr` |

## How the subagents fit with the skills

Subagents do the work; the project skills run the repeatable procedures around it.

| Skill | Role in the workflow |
| --- | --- |
| `/run-todo-app` | Start the server to try a change by hand between Build and Verify |
| `/review-and-pr` | Final `/code-review` plus PR, for bigger or riskier changes |
| `/create-pr` | Branch, commit, push and open the PR. Never merges |
| `/rtk` | Shorter command output, to save tokens on long sessions |

## Rules every subagent follows

- No `npm install`, packages or build step. The project settings deny installs.
- Builders run `npm test` before reporting. Auditors only read.
- No subagent commits, pushes or merges. That stays with you and `/create-pr`.
- Each subagent ends with a short report (files changed, new keys or routes, test results, findings) so the next one in the chain knows where to start.

## Changing the subagents

Each subagent is a Markdown file with frontmatter (`name`, `description`, `tools`, `model`) in `.claude/agents/`. Edit the file to change its rules. The
`description` decides when Claude Code picks the agent on its own, so keep the "Use when" part accurate. Run `/agents` in Claude Code to list them.
