# Developer documentation

This document describes how the TODO app is built. For features and how to run it, see the [README](../README.md).

The app is plain HTML, CSS and JavaScript. There is no build step and no dependencies. Scripts are loaded as classic `<script>` tags, so everything shares one global scope.

The page runs in one of two modes, picked when it loads (`detectMode()` in `app.js`):

| Mode | When | Where tasks are kept |
| --- | --- | --- |
| Account mode | Served by the Node server (`npm start`), which answers `/api/auth/me` | On the server, per user. People must sign in. |
| Local mode | Opened as a file, or served by a plain static server (the API answers 404 or not at all) | In this browser's `localStorage`, as before accounts existed. |

The server is described in [Accounts and the server](#accounts-and-the-server) below.

## Files

| File | Role |
| --- | --- |
| `index.html` | Page layout. Marks translatable text with `data-i18n` attributes. Loads `i18n.js`, then `app.js`. |
| `i18n.js` | Defines the global `TRANSLATIONS` object. |
| `app.js` | All app logic: state, storage, rendering and event handling. |
| `styles.css` | Styles, with colors defined as CSS variables for the light and dark themes. |

Load order matters: `app.js` reads `TRANSLATIONS` at startup, so `i18n.js` must come first.

## Data model

A task is a plain object:

```js
{ id: 'lq3k9x2ab1cd', text: 'Buy milk', done: false }
```

- `id`: `Date.now()` in base 36 followed by 4 random base-36 characters. Used to find a task when it is toggled or deleted.
- `text`: the trimmed text the user typed (at most 200 characters, enforced by `maxlength` on the input).
- `done`: whether the task is completed.

## State

`app.js` keeps four module-level variables:

| Variable | Type | Meaning |
| --- | --- | --- |
| `todos` | array of tasks | All tasks, in the order they were added. |
| `filter` | `'all'` \| `'active'` \| `'completed'` | Current filter. Not persisted; resets to `all` on reload. |
| `lang` | string | Language code, a key of `TRANSLATIONS`. |
| `theme` | `'light'` \| `'dark'` | Current theme. |

## Persistence

State is stored in the browser's `localStorage`, JSON-encoded, under these keys (`STORAGE_KEYS`):

| Key | Value |
| --- | --- |
| `todo-items` | The `todos` array |
| `todo-theme` | `"light"` or `"dark"` |
| `todo-lang` | A language code such as `"en"` |

- `load(key, fallback)` returns the parsed value, or `fallback` if the key is missing, the JSON is invalid or storage is unavailable.
- `save(key, value)` writes the value and silently ignores errors (for example in private browsing), so the app keeps working for that visit without saving.

## Startup

1. `lang` comes from storage, otherwise `detectLanguage()`.
2. `theme` comes from storage, otherwise `detectTheme()`.
3. Event listeners are attached.
4. `start()` runs at the end of the file. It calls `applyLanguage()` (page language, translations, theme, `render()`), then:
   1. takes a `?verify=` or `?reset=` token from the address and removes it from the address bar,
   2. calls `detectMode()`,
   3. in local mode, loads `todos` from storage and shows the list;
   4. in account mode, confirms the email or opens the reset form if a token came in, then shows the task list if signed in, otherwise the sign-in screen.

The task list (`#todo-view`) starts hidden so a signed-out visitor never sees an empty list flash before the sign-in screen.

`index.html` also contains a small inline script in `<head>`. It reads `todo-theme` and sets `data-theme` on `<html>` before the first paint, which avoids a flash of the wrong theme.

## Function reference (`app.js`)

### Storage

- `load(key, fallback)`: reads and parses a stored value (see above).
- `save(key, value)`: stringifies and stores a value.

### Language

- `detectLanguage()`: takes the first two letters of `navigator.language`. Returns that code if `TRANSLATIONS` has it, otherwise `'en'`.
- `t(key)`: returns the translation for `key` in the current language, or `undefined` if the key is missing. Falls back to `TRANSLATIONS.en` only when the whole language is missing, not for a single missing key, so every language needs every key.
- `applyLanguage()`: updates `<html lang>`, the language select, every element with `data-i18n` (text) or `data-i18n-placeholder` (placeholder), and the document title. Then calls `applyTheme()` (so the toggle's label is retranslated) and `render()`.

### Theme

- `detectTheme()`: returns `'dark'` if the OS prefers a dark color scheme, otherwise `'light'`.
- `applyTheme()`: sets `data-theme` on `<html>`, and sets the toggle button's icon (☀️ in dark mode, 🌙 in light mode), `aria-label` and tooltip.

### Tasks

These are `async`. In account mode they call the API first and update `todos` only if it succeeds; in local mode they update `todos` and save to `localStorage`. Event handlers call them through `run()`, which shows any API error in the status line (and returns to the sign-in screen on a 401).

- `addTodo(text)`: appends a new task, saves and re-renders.
- `toggleTodo(id)`: flips `done` for the matching task, saves and re-renders.
- `deleteTodo(id)`: removes the matching task, saves and re-renders.
- `clearCompletedTodos()`: removes every done task, saves and re-renders.
- `render()`: rebuilds the task list from `todos` and `filter`, using `createElement` and `textContent` (so task text is never parsed as HTML). It also updates:
  - the empty message (shown when no tasks are visible),
  - the "items left" counter (counts all tasks that are not done, regardless of filter),
  - the "Clear completed" button (shown only when at least one task is done),
  - the active state of the filter buttons.

## Events

| Element | Event | Behavior |
| --- | --- | --- |
| `#todo-form` | `submit` | Trims the input. Ignores empty text. Otherwise adds the task, clears the input and refocuses it. |
| `[data-filter]` buttons | `click` | Sets `filter` and re-renders. |
| `#clear-completed` | `click` | Removes all done tasks, saves and re-renders. |
| `#theme-toggle` | `click` | Flips `theme`, saves it and calls `applyTheme()`. |
| `#language-select` | `change` | Sets `lang`, saves it and calls `applyLanguage()`. |
| Task checkbox / ✕ button | `change` / `click` | Created in `render()`. Call `toggleTodo` / `deleteTodo`. |

## Translations (`i18n.js`)

`TRANSLATIONS` maps a language code to an object of keys: the todo screen (`title`, `placeholder`, `itemsLeft` and so on), the sign-in screens (`signIn`, `signUpHeading`, `forgotPassword` and so on) and the messages (`resetSent`, `sessionExpired`, and the `err*` keys used for server errors). `tests/translations.test.js` fails if any language is missing a key that `index.html` or `app.js` uses.

All values are strings except `itemsLeft`, which is a function `(n) => string` so each language can apply its own plural rules (Polish, for example, has separate forms for 1, 2 to 4, and 5 or more).

Currently supported: `en`, `fr`, `pt`, `es`, `pl`.

### Adding a language

1. In `i18n.js`, copy the `en` block under a new code and translate every value, including a correct `itemsLeft` plural function.
2. In `index.html`, add `<option value="code">Name</option>` to `#language-select`.

### Adding translatable text

1. Add the key to every language block in `i18n.js`.
2. In `index.html`, set `data-i18n="key"` (text content) or `data-i18n-placeholder="key"` (placeholder) on the element. For text created in JavaScript, call `t('key')`.

## Styling (`styles.css`)

- Colors are CSS variables on `:root` (light theme): `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--accent-text`, `--danger` and `--shadow`.
- `[data-theme="dark"]` overrides the same variables. Switching theme only changes the `data-theme` attribute on `<html>`.
- `.visually-hidden` hides labels visually while keeping them available to screen readers.
- A media query near the end of the file adjusts `.app` and `.app-header` for small screens.

## Accessibility

- Inputs have labels (visually hidden), and icon-only buttons have an `aria-label` and tooltip that follow the current language.
- The page language (`<html lang>`) follows the selected language.
- Task checkboxes and delete buttons have translated `aria-label`s.

## Accounts and the server

`npm start` runs `server/server.js`. It serves the four app files and a JSON API, using only built-in Node modules (`node:http`, `node:crypto`, `node:sqlite`), so there is still nothing to install. It needs Node 22.13 or newer. The design it follows (requirements, data model, threat table, trade-offs) was written up before the code; the choices below match it except where noted.

### Files

| File | Role |
| --- | --- |
| `server/server.js` | Entry point. Reads settings from environment variables and starts the HTTP server. |
| `server/app.js` | `createApp()`: every route, session handling, CSRF checks, static files and security headers. Takes its database, mailer, hasher and clock as arguments so tests can swap them. |
| `server/db.js` | Opens the SQLite database and creates the tables. |
| `server/passwords.js` | Password hashing (scrypt) and the password policy. |
| `server/tokens.js` | Random secrets and their SHA-256 hashes. |
| `server/rate-limit.js` | In-memory fixed-window rate limiter. |
| `server/http.js` | JSON bodies (16 KB limit), cookies, error responses. |
| `server/mailer.js` | Development mailer: prints emails to the terminal. |

### Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `APP_URL` | `http://localhost:<PORT>` | Public address, used in email links and the origin check. |
| `DATABASE_PATH` | `data/todo.db` | SQLite file (the `data/` folder is git-ignored). |
| `NODE_ENV` | | `production` turns on secure cookies and HSTS. |
| `COOKIE_SECURE` | on in production | `1` or `0` to force `Secure` + `__Host-` cookies on or off. Needs HTTPS. |
| `TRUST_PROXY` | off | `1` to take the client IP from `X-Forwarded-For`. Only behind a proxy you control. |

### Data

Tables: `users`, `password_credentials`, `sessions`, `auth_tokens` (email verification and password reset links) and `todos`. Deleting a user deletes their rows in every other table. Passwords, session tokens and link tokens are never stored, only their hashes.

### API

All state-changing calls must send `Content-Type: application/json`. Errors are `{ "error": "<code>" }`.

| Method and path | Body | Answer |
| --- | --- | --- |
| `POST /api/auth/signup` | `email`, `password` | 202 `check_email`, for new and taken emails alike. The page then signs in. |
| `POST /api/auth/login` | `email`, `password`, `remember` | 200 `{ user }` and the session cookie, or 401 `invalid_credentials` |
| `POST /api/auth/logout` | | 204, cookie cleared |
| `POST /api/auth/logout-all` | | 204, every session of this user revoked |
| `GET /api/auth/me` | | 200 `{ user }` or 401 |
| `POST /api/auth/verify-email` | `token` | 200 |
| `POST /api/auth/resend-verification` | | 202 |
| `POST /api/auth/password/forgot` | `email` | Always 202 |
| `POST /api/auth/password/reset` | `token`, `password` | 200 `{ user }` and a new cookie; all other sessions revoked |
| `POST /api/auth/password/change` | `currentPassword`, `newPassword` | 200 and a new cookie; all other sessions revoked |
| `DELETE /api/auth/account` | `password` | 204; the account and its tasks are deleted |
| `GET /api/todos` | | 200 `{ todos }` |
| `POST /api/todos` | `text` | 201 `{ todo }` |
| `PATCH /api/todos/:id` | `done` | 200 `{ todo }`, or 404 if it is not yours |
| `DELETE /api/todos/:id` | | 204, or 404 if it is not yours |
| `POST /api/todos/clear-completed` | | 200 `{ removed }` |

`user` is `{ id, email, emailVerified }`; `todo` is `{ id, text, done }`, the same shape the page has always used. Change password and delete account have no screens yet; they are API-only for now.

### Security

| Risk | What the server does |
| --- | --- |
| Stolen database | scrypt (N=2^17, r=8, p=1) with a random salt per password. Session and link tokens stored as SHA-256 hashes. |
| Session theft by script | Cookie is `HttpOnly` and `SameSite=Lax` (`Secure` and `__Host-` prefixed in production). The page never sees it. Content-Security-Policy allows only the app's own scripts plus the inline theme script by hash. |
| Cross-site requests (CSRF) | State-changing calls must be JSON, and are refused when `Origin` is another site or `Sec-Fetch-Site` is `cross-site`. |
| Session fixation | A new session token on every sign-in, password change and reset. |
| Guessing passwords | 20 sign-in attempts per IP per 10 minutes; 5 failures lock that email for 15 minutes. Limits on signup, reset and resend too. |
| Finding out who has an account | Same answer and similar timing for known and unknown emails on sign-in, sign-up and forgot-password. |
| Old sessions | 24 hours idle (30 days with "Keep me signed in"), 90 days at most. Revoked on sign-out, password change and reset. Expired rows are purged hourly. |
| Email links | 256-bit random, single use, 24 hours (verify) or 30 minutes (reset); a newer link cancels the older one. Stripped from the address bar on arrival; `Referrer-Policy: no-referrer`. |

Differences from the design: scrypt instead of Argon2id (Node 22 has no built-in Argon2 and the project installs no packages); no breached-password check (it needs a network call to Have I Been Pwned); a 15-minute lock after 5 failures rather than growing delays; rate-limit counters in memory, so they reset on restart and are per process; account deletion is immediate rather than a 30-day soft delete; Sign in with Google is not built yet.

### Email

In development the server prints each email, with its link, in the terminal. To send real email, pass `createApp()` a `mailer` whose `send({ to, subject, text })` calls your email provider.

## Tests

```bash
npm test
```

Runs `node --test` with no packages. Each server test starts the real HTTP server on a random port with an in-memory database and a fake clock, so expiry and rate-limit windows are tested without waiting.

| File | Covers |
| --- | --- |
| `tests/units.test.js` | Hashing, password policy, secrets, rate limiter, cookie parsing |
| `tests/auth.test.js` | Sign-up, sign-in, sessions and expiry, sign-out, verification, reset, change password, delete account, rate limits, purge |
| `tests/todos-and-security.test.js` | Todo routes, users kept apart, CSRF, bad bodies, static files, headers, production cookies |
| `tests/translations.test.js` | Every language has every key the page uses |

## Known limitations

- Tasks cannot be edited after they are added.
- The filter is not remembered across reloads.
- In local mode, data lives only in one browser on one device; clearing site data deletes the tasks.
- Tasks saved in local mode are not moved into an account when you sign in.
- Several tabs open at once do not sync; in account mode a reload shows the latest tasks.
- Change password, sign out everywhere and delete account have API routes but no screens yet.
- The diagrams in `docs/diagrams/` show local mode.
