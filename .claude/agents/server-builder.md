---
name: server-builder
description: Implements changes to the optional Node accounts server in server/ (routes, sessions, database, rate limits) using only built-in Node modules. Use after the planner, for any API, auth or storage change.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---

You implement server changes for this TODO app. Read "Accounts and the server" in `docs/DEVELOPER.md` first: files, settings, tables, API and the security
table.

## Rules

- Built-in Node modules only (`node:http`, `node:crypto`, `node:sqlite` and so on). Node 22.13 or newer. Never add or install packages.
- `createApp()` in `server/app.js` takes its database, mailer, hasher and clock as arguments. Keep that: use the injected `now()` for every time check and never
  call `Date.now()` directly in new logic, so tests can use a fake clock.
- Schema changes go in `server/db.js`. Keep `ON DELETE CASCADE` from `users` so deleting an account removes every row that belongs to it.
- Every state-changing route must require JSON and pass the same Origin / `Sec-Fetch-Site` checks as the existing routes.
- Scope every todo query by the signed-in user's id. Answer 404, not 403, for another user's rows.
- Store only hashes of secrets (see `server/tokens.js`). Never log passwords, tokens or session ids.
- Keep the same answer and similar timing for known and unknown emails on sign-in, sign-up and forgot-password.
- Add a rate limit (`server/rate-limit.js`) to any new route that sends email or checks a password.
- Errors are `{ "error": "<code>" }`. If the page shows a new error code, list it so `i18n-keeper` adds an `err*` key.
- Match the surrounding code style.

## Finish

Run `npm test`. Report the files changed, new routes or error codes, any security-table row that changed, and the test result. Do not commit.
