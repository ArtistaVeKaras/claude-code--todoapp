# Plan: Clear all, Undo, and time added

Planned by `planner` on 2026-10-23 on branch `feat/inline-task-editing`. This copy is saved after the work was done, so it records the owner's decisions and
the outcome.

## Goal

A Clear all button that removes every task after a confirmation dialog and can be undone, in both modes. Each task shows when it was added, compactly, in the
current language.

## Owner's decisions

| Question | Decision |
| --- | --- |
| Undo in account mode? | Yes, using a separate `deleted_todos` trash table, so live task queries don't change |
| Undo for Clear completed too? | Yes, the same mechanism |
| Portuguese date format | European (`pt-PT`). New pt strings use European wording |
| Time label | Compact: "now", "5 min", "14:05", "23 Oct", "23 Oct 2025". Full "Added …" date on hover and for screen readers |
| Where Undo puts tasks back (account mode) | Their original positions, as in local mode |
| Browser verification | Playwright suite in `tests/e2e/`, plus Playwright MCP for interactive checks, plus a headed run at the end of every run |

## Contract

- **API:**
  - Every todo is `{ id, text, done, createdAt }`.
  - `DELETE /api/todos` with `{ confirm: "all" }` → `{ removed, undo }`.
  - `POST /api/todos/clear-completed` → `{ removed, undo }`.
  - `POST /api/todos/restore` with `{ undo }` → `{ todos }`.
  - Errors: `confirm_required`, `undo_required`, `undo_expired`, `too_many_todos`.
- **Keys:** `clearAll`, `clearAllTitle`, `clearAllConfirm(n)`, `clearAllConfirmButton`, `cancel`, `allCleared`, `completedCleared`, `undo`, `tasksRestored`,
  `timeNow`, `addedOn(date)`, `errUndoExpired`, `errTooManyTodos`, `errConfirmRequired`, `errUndoRequired`.
- **DOM:** `#clear-all`, `#clear-all-dialog`, `#clear-all-message`, `#undo-bar`, `#undo-message`, `#undo-clear`, `time.todo-time`, `.todo-time-short`.

## Both modes

| | Local mode | Account mode |
| --- | --- | --- |
| Clear all / Clear completed | Empties the list and saves; keeps a snapshot in memory | Server moves the rows to `deleted_todos` and returns an `undo` token |
| Undo | Restores the snapshot; no timer; lost on reload | `POST /api/todos/restore`; the bar hides after 15 minutes minus 5 seconds |
| Order after Undo | Original | Original (tasks added in between go after) |
| Time added | `createdAt` on add; older tasks recover it from their id | `created_at` from the server |

## Outcome

- Built as planned, plus fixes from the audits: rate limits for each task route and for restore, trash purged at startup and on use, focus handling, a
  320 px layout and a screen-reader description for the time label.
- **Found by the owner in the browser:** errors never cleared (an older bug), Undo was offered without a server token, and a stale server process. All
  three are fixed and covered by `tests/e2e`.
- These lessons changed the workflow; see "Lessons from the clear-all feature" in [SUBAGENTS.md](../SUBAGENTS.md).
