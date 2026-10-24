# Developer documentation

This document describes how the TODO app is built. For features and how to run it, see the [README](../README.md).

The app is plain HTML, CSS and JavaScript. There is no build step and no dependencies. Scripts are loaded as classic `<script>` tags, so everything shares one
global scope.

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
{ id: 'lq3k9x2ab1cd', text: 'Buy milk', done: false, createdAt: 1767225600000 }
```

- `id`: `Date.now()` in base 36 followed by 4 random base-36 characters (padded with `0` to exactly 4). Used to find a task when it is toggled, edited or
  deleted.
- `text`: the trimmed text the user typed (at most 200 characters, enforced by `maxlength` on the input). It can be edited later, with the same limit.
- `done`: whether the task is completed.
- `createdAt`: when the task was added, in milliseconds since 1970. Set by `addTodo()` in local mode and by the server in account mode (its `created_at`
  column). `createTimeElement()` shows nothing for a task whose `createdAt` is missing or not a finite number.

Tasks saved in local mode before `createdAt` existed get it when the page loads: `backfillCreatedAt()` reads the id without its last 4 characters as base 36. It
sets `createdAt` only if the result falls between 1 January 2020 and one day from now, and saves the list if it changed anything. Ids in any other format are
left without `createdAt` and show no time.

## State

The main module-level variables in `app.js` are:

| Variable | Type | Meaning |
| --- | --- | --- |
| `todos` | array of tasks | All tasks, in the order they were added. |
| `filter` | `'all'` \| `'active'` \| `'completed'` | Current filter. Not persisted; resets to `all` on reload. |
| `lang` | string | Language code, a key of `TRANSLATIONS`. |
| `editingId` | string or `null` | Id of the task being edited. |
| `editDraft` | string | What has been typed in the edit field so far. |
| `editSaving` | boolean | True while the edit is being sent to the server. The field is read-only meanwhile. |
| `editErrorShown` | boolean | A failed save left an error in the status line. It is cleared after the next successful save. |
| `pendingEditId` | string or `null` | A task whose Edit was clicked while another edit was still saving. It opens when that save succeeds. |
| `pointerDown` | boolean | A mouse button is held, so a click is still on its way. |
| `undoState` | object or `null` | The clear that can be undone: `{ token, todos, messageKey, timer }`. `token` is the server's undo token (`null` in local mode), `todos` is a copy of the list before the clear, `messageKey` picks the bar text, `timer` hides the bar in account mode. |
| `undoing` | boolean | True while an undo request is running. A second click does nothing. |
| `ACCOUNT_UNDO_WINDOW_MS` | constant | 15 minutes minus 5 seconds. Account mode hides the undo bar after this long, a little before the server's own 15 minutes (`UNDO_WINDOW`) ends. |

The edit variables live here, not in the DOM, because `render()` rebuilds the list. They are not persisted. `resetEdit()` clears them on sign-in and sign-out.

`undoState` is not persisted either. In local mode it holds the whole previous list and has no timer, so the bar stays until another task action, sign-in or
sign-out hides it, and a reload loses it.

## Persistence

State is stored in the browser's `localStorage`, JSON-encoded, under these keys (`STORAGE_KEYS`):

| Key | Value |
| --- | --- |
| `todo-items` | The `todos` array |
| `todo-theme` | `"light"` or `"dark"`. Stored only while the user overrides the system scheme; removed otherwise. |
| `todo-lang` | A language code such as `"en"` |

- `load(key, fallback)` returns the parsed value, or `fallback` if the key is missing, the JSON is invalid or storage is unavailable.
- `save(key, value)` writes the value and silently ignores errors (for example in private browsing), so the app keeps working for that visit without saving.

## Startup

1. `lang` comes from storage, otherwise `detectLanguage()`.
2. Event listeners are attached.
3. `start()` runs at the end of the file. It calls `applyLanguage()` (page language, translations, `render()`), then:
   1. takes a `?verify=` or `?reset=` token from the address and removes it from the address bar,
   2. calls `detectMode()`,
   3. in local mode, loads `todos` from storage, runs `backfillCreatedAt()` on them and shows the list;
   4. in account mode, confirms the email or opens the reset form if a token came in, then shows the task list if signed in, otherwise the sign-in screen.

The task list (`#todo-view`) starts hidden so a signed-out visitor never sees an empty list flash before the sign-in screen.

`index.html` also contains a small inline script in `<head>`. It reads `todo-theme` and, if the value is `"light"` or `"dark"`, sets
`<meta name="color-scheme">` to it before the first paint, which avoids a flash of the wrong theme. `app.js` does not read the saved theme at startup.

## Function reference (`app.js`)

### Storage

- `load(key, fallback)`: reads and parses a stored value (see above).
- `save(key, value)`: stringifies and stores a value.

### Language

- `detectLanguage()`: takes the first two letters of `navigator.language`. Returns that code if `TRANSLATIONS` has it, otherwise `'en'`.
- `t(key)`: returns the translation for `key` in the current language, or `undefined` if the key is missing. Falls back to `TRANSLATIONS.en` only when the whole
  language is missing, not for a single missing key, so every language needs every key.
- `applyLanguage()`: updates `<html lang>`, the language select, every element with `data-i18n` (text) or `data-i18n-placeholder` (placeholder), and the
  document title. Then calls `renderAuth()`, `renderStatus()` and `render()`.

### Theme

The page follows the system color scheme unless the user picked the other one. The choice lives in `<meta name="color-scheme">` in `index.html`: `light dark`
means follow the system, `light` or `dark` is an override. The CSS reads the meta tag (see Styling), and also decides which of the toggle's two icons and labels
is shown.

- `applyTheme(override)`: sets the meta tag's `content` to `override` if it is `'light'` or `'dark'`, otherwise to `light dark`.
- `toggleTheme()`: works out the current scheme (the override, or the system's from `prefers-color-scheme` if there is none) and switches to the other one. If
  that is the system's own scheme, it removes `todo-theme` from storage and calls `applyTheme(null)`. Otherwise it saves the scheme under `todo-theme` and
  calls `applyTheme()` with it.

### Undo

Clear all and Clear completed can be undone. Only the latest clear is kept.

- `offerUndo(snapshot, token, messageKey)`: calls `showUndo()`, then `rescueFocus(els.undoClear)`, which moves focus to Undo if the control that had it is gone.
  If focus ends up on Undo, its `aria-describedby="undo-message"` reads the message. Otherwise it announces `messageKey` through the live region.
- `showUndo(snapshot, token, messageKey)`: hides any earlier bar, stores `undoState` and renders. In account mode it starts a timer of
  `ACCOUNT_UNDO_WINDOW_MS` that calls `hideUndo()`. In local mode there is no timer.
- `hideUndo()`: clears the timer and `undoState` and renders. If focus was inside the bar, it moves to the task input. Every task action, sign-in and sign-out
  calls it.
- `renderUndo()`: shows `#undo-bar` only while `undoState` is set, and puts the translated message in `#undo-message`. `render()` calls it, so a language change
  updates the text.
- `undoClear()`: does nothing without `undoState` or while `undoing`. In account mode it calls `POST /api/todos/restore` with the token and replaces `todos`
  with the answer. In local mode it puts the saved copy back and saves it. On `undo_expired` it hides the bar and rethrows, so `run()` shows the error. On
  success it re-renders, announces `tasksRestored`, hides the bar and focuses the input.

### Time added

- `intlLocale()`: the locale passed to `Intl`: `pt-PT` when `lang` is `pt`, otherwise `lang`.
- `formatter(key, create)`: returns an `Intl` formatter from a cache keyed by locale and `key`, building it with `create(locale)` the first time.
- `formatAddedAt(ms)`: compact text for a time. Under 1 minute old: `timeNow`. Under 60 minutes: minutes as a short unit ("5 min"). Today: the short time.
  This year: day and month. Older: day, month and year.
- `createTimeElement(item, index)`: builds the `<time>` for a row, or returns `null` if `item.createdAt` is not a finite number or not a valid date. The element
  has `id="todo-time-<index>"` and a `dateTime` in ISO form. It holds an `aria-hidden` `.todo-time-short` span with the compact text and a `title` of the full
  date, and a `.visually-hidden` span with `addedOn(full date)`. The full date uses `dateStyle: 'medium'` and `timeStyle: 'short'`.
- `refreshTaskTimes()`: rewrites the compact text of each visible time. It does nothing while `document.hidden`, never calls `render()` (so an open edit is
  untouched), and writes a span only when its text changed.
- `backfillCreatedAt(list)`: see Data model. It is called once from `start()`.

### Tasks

These are `async`. In account mode they call the API first and update `todos` only if it succeeds; in local mode they update `todos` and save to `localStorage`.
Event handlers call them through `run()`, which shows any API error in the status line (and returns to the sign-in screen on a 401). When a new action starts,
`run()` first clears an error left by an earlier action, except the edit field's own `errTaskEmpty` error.

- `addTodo(text)`: hides the undo bar, appends a new task, saves and re-renders. In local mode the task gets `createdAt: Date.now()` and an id built from the
  same value.
- `toggleTodo(id)`: hides the undo bar, flips `done` for the matching task, saves and re-renders.
- `editTodo(id, text)`: hides the undo bar, then sets the text of the matching task (in account mode, from the server's answer to `PATCH`), ends the edit,
  saves, re-renders and announces `taskEdited`.
- `startEdit(id)`: opens the edit field for a task and selects its text. Does nothing while a save is running. If another task is being edited, it first
  finishes that edit as a blur would. If that save is still running, `pendingEditId` is set and the edit opens afterwards.
- `commitEdit(source, refocus)`: ends the open edit. `source` is `'enter'` or `'blur'`. Unchanged text cancels. Empty text cancels on blur; on Enter it keeps
  the field open, sets `aria-invalid` and shows `errTaskEmpty` (pressing Enter again re-announces it). Otherwise it makes the field read-only and saves through
  `run()`. On success, Enter returns focus to the Edit button, and `refocus` (`{ id, control }`) returns it to the control the user was moving to. On failure
  the field stays open with the typed text. A `not_found` answer also removes the task from `todos`.
- `cancelEdit()`: drops the edit, clears `errTaskEmpty` and re-renders.
- `resetEdit()`: clears all the edit variables.
- `createEditField(id)`: builds the text input that replaces a row (see Events and Accessibility).
- `focusEditButton(id)`: focuses the Edit button of a row, or the add-task input if the row is gone.
- `focusControl(ref)`: focuses the control `ref.control` in row `ref.id`, if it exists.
- `deleteTodo(id)`: hides the undo bar, removes the matching task, saves and re-renders.
- `clearCompletedTodos()`: hides the undo bar and copies the list. In account mode it calls `POST /api/todos/clear-completed` and keeps the `undo` token from
  the answer. It removes every done task, saves and re-renders. If something was removed (and, in account mode, the server returned an `undo` token) it calls
  `offerUndo()` with `completedCleared`; otherwise it only
  announces `completedCleared`.
- `clearAllTodos()`: hides the undo bar and copies the list. It disables `#clear-all` while the request runs. In account mode it calls
  `DELETE /api/todos` with `{ confirm: 'all' }` and keeps the `undo` token. It empties `todos`, saves (local mode), calls `resetEdit()` and re-renders. If the
  list had tasks (and, in account mode, the server returned an `undo` token) it calls `offerUndo()` with `allCleared`; otherwise it announces `allCleared` and
  focuses the input.
- `render()`: rebuilds the task list from `todos` and `filter`, using `createElement` and `textContent` (so task text is never parsed as HTML). A row has a
  checkbox, the text, the time added (`createTimeElement()`, left out when it returns `null`), an Edit button and a delete button. The checkbox gets
  `aria-describedby` pointing at the time element. The row of the task in `editingId` has only the edit field from `createEditField()`. If that task is
  no longer visible (deleted, or hidden by the filter), the edit is dropped. It also updates:
  - the empty message (shown when no tasks are visible),
  - the "items left" counter (counts all tasks that are not done, regardless of filter),
  - the "Clear completed" button (shown only when at least one task is done),
  - the "Clear all" button (hidden when `todos` is empty),
  - the undo bar, through `renderUndo()`,
  - the active state of the filter buttons.

## Events

| Element | Event | Behavior |
| --- | --- | --- |
| `#todo-form` | `submit` | Trims the input. Ignores empty text. Otherwise adds the task, clears the input and refocuses it. |
| `[data-filter]` buttons | `click` | Sets `filter` and re-renders. |
| `#clear-completed` | `click` | Calls `clearCompletedTodos()`, then moves focus to the task input if the button hid itself. |
| `#clear-all` | `click` | Puts the task count in the dialog text through `clearAllConfirm(n)`, resets `returnValue` to `''` and calls `showModal()`. |
| `#clear-all-dialog` | `close` | Calls `clearAllTodos()` only if `returnValue` is `'confirm'`. Cancel and Escape give another value. |
| `#undo-clear` | `click` | Calls `undoClear()`. |
| `window` | timer, every 60 s | `setInterval` calls `refreshTaskTimes()`. |
| `document` | `visibilitychange` | Calls `refreshTaskTimes()`, which does nothing while the tab is hidden. |
| `#theme-toggle` | `click` | Calls `toggleTheme()`. |
| `window` | `storage` | When `todo-theme` changes in another tab, calls `applyTheme()` with the stored value. |
| `#language-select` | `change` | Sets `lang`, saves it and calls `applyLanguage()`. |
| Task checkbox / ✕ button | `change` / `click` | Created in `render()`. Call `toggleTodo` / `deleteTodo`. |
| Task text | `dblclick` | Calls `startEdit(id)`. |
| Edit (✎) button | `click` | Calls `startEdit(id)`. |
| Edit field | `keydown` Enter | Calls `commitEdit('enter')`, then focuses the Edit button if the edit ended at once. Ignored while saving. |
| Edit field | `keydown` Escape | Calls `cancelEdit()` and focuses the Edit button. Ignored while saving. |
| Edit field | `input` | Stores the text in `editDraft` and clears the invalid state and `errTaskEmpty`. |
| Edit field | `blur` | Saves like Enter, but empty text cancels. If focus moves to another control in the list, it waits for the click to finish and then restores focus to that control. |
| Edit field | `compositionstart` / `compositionend` | Enter and Escape are ignored during an IME composition. |
| `document` | `mousedown` / `mouseup` | Set and clear `pointerDown`. |

## Translations (`i18n.js`)

`TRANSLATIONS` maps a language code to an object of keys: the todo screen (`title`, `placeholder`, `itemsLeft` and so on), the sign-in screens (`signIn`,
`signUpHeading`, `forgotPassword` and so on) and the messages (`resetSent`, `sessionExpired`, and the `err*` keys used for server errors).
Editing uses `edit` (button label), `editTask` (field label), `editHint` (the hidden hint the field points to), `taskEdited` (announcement), `errTaskEmpty` and
`errTaskNotFound`.
Clearing and undo use `clearAll`, `clearAllTitle`, `clearAllConfirm`, `clearAllConfirmButton`, `cancel`, `allCleared`, `undo`, `tasksRestored` and the errors
`errUndoExpired`, `errTooManyTodos`, `errConfirmRequired` and `errUndoRequired` (reached through `ERROR_KEYS`). The time added uses `timeNow` and `addedOn`.
`tests/translations.test.js` fails if any language is missing a key that `index.html` or `app.js` uses.

All values are strings except three functions. `itemsLeft` and `clearAllConfirm` take `(n)` and return a string, so each language can apply its own plural rules
(Polish, for example, has separate forms for 1, 2 to 4, and 5 or more). `addedOn` takes the formatted full date and returns the sentence for screen readers and
the tooltip ("Added ...").

Portuguese is moving to European Portuguese (`pt-PT`, also used for date formats by `intlLocale()`). The strings added with clearing, undo and the time added
are European ("Anular", "Limpar tudo"); older Portuguese strings are still Brazilian.

Currently supported: `en`, `fr`, `pt`, `es`, `pl`.

### Adding a language

1. In `i18n.js`, copy the `en` block under a new code and translate every value, including a correct `itemsLeft` plural function.
2. In `index.html`, add `<option value="code">Name</option>` to `#language-select`.

### Adding translatable text

1. Add the key to every language block in `i18n.js`.
2. In `index.html`, set `data-i18n="key"` (text content) or `data-i18n-placeholder="key"` (placeholder) on the element. For text created in JavaScript, call
   `t('key')`.

## Styling (`styles.css`)

- Each color has a `-light` and a `-dark` token on `:root` (for example `--bg-light`, `--bg-dark`). The variables the rules use (`--bg`, `--surface`, `--text`,
  `--muted`, `--border`, `--control-border`, `--accent`, `--accent-text`, `--danger`) are set with `light-dark()`, which follows the used `color-scheme`.
  `--shadow` is switched separately because `light-dark()` only takes colors.
- `:root` sets `color-scheme: light dark`. `:root:has(> head > meta[name="color-scheme"][content="light"])` and the `dark` version set `color-scheme: light` or
  `dark`. Switching theme only changes the meta tag's `content`.
- With no override, `@media (prefers-color-scheme: dark)` applies the dark `--shadow` and the toggle icon swap, guarded by
  `:root:not(:has(... [content="light"]))`.
- The toggle holds two spans: `.theme-to-dark` (🌙, the default) and `.theme-to-light` (☀️). CSS shows the one that leads away from the current scheme.
- Inside `@supports not (color: light-dark(white, black))`, the same conditions assign the `-light` or `-dark` tokens to the variables directly.
- `.visually-hidden` hides labels visually while keeping them available to screen readers.
- `.edit-button` shares its rules with `.delete-button` (24px minimum, 44px under `pointer: coarse`). Its hover color is `--accent`.
- `.todo-edit` is the edit field. Its border uses `--control-border`, and `[aria-invalid="true"]` switches the border to `--danger`.
- `.todo-time` is the time added: muted, 0.78rem, `flex-shrink: 0` and `white-space: nowrap`. `.todo-text` has `min-width: 0` so long text wraps instead of
  pushing the time out. `.todo-time-short` is the visible span inside it.
- At 480px and below, `.todo-item` becomes a grid (`auto minmax(0, 1fr) auto auto`). `.todo-time` goes to row 2 and spans from column 2 to the end, under the
  text, and `.todo-edit` spans the whole row.
- `.footer-actions` holds Clear completed and Clear all in a wrapping flex row. `.app-footer` wraps too.
- `.link-button` and `.text-button` are `inline-flex` with a 24px minimum block size. Under `pointer: coarse`, `.danger-button` and `.dialog-actions button`
  join the 44px rule.
- `.undo-bar` (also a `.notice`) is a flex row with the message and the Undo button, with a top margin so it sits below the list.
- `.confirm-dialog` styles the native `<dialog>`: surface colors, a `--control-border` border, a 400px maximum width that fits narrow screens, and a half-black
  `::backdrop`. `.dialog-actions` lays out its buttons at the right, wrapping if needed.
- `.danger-button` (Clear all in the dialog) uses `--danger` as background and `--accent-text` as text color.
- A media query near the end of the file adjusts `.app` and `.app-header` for small screens.

## Accessibility

- Inputs have labels (visually hidden), and icon-only buttons have an `aria-label` and tooltip that follow the current language.
- The page language (`<html lang>`) follows the selected language.
- Task checkboxes and delete buttons have translated `aria-label`s.
- The Edit button is named "Edit <task>" with `aria-labelledby` (its own label plus the task text).
- The edit field has an `aria-label` (`editTask`) and `aria-describedby="edit-hint"`, which points to a visually hidden paragraph in `index.html`. When the text
  is empty it also has `aria-invalid="true"` and `status-message` in its description, so the error is read.
- After Enter or Escape, focus returns to the row's Edit button. Pressing Enter on empty text again re-announces the error.
- A successful edit is announced through the live region (`taskEdited`).
- Clear all uses a native modal `<dialog>` with `aria-labelledby` (the title) and `aria-describedby` (the count message). Cancel has `autofocus`, so it is the
  default. Escape closes the dialog as a cancel, and `returnValue` is reset on open so an earlier Confirm cannot make Escape clear.
- After Clear all or Clear completed, focus moves to Undo (`rescueFocus`) if the control that had it was hidden. Undo has `aria-describedby="undo-message"`, so
  focusing it reads the message. If focus stays elsewhere, the message is announced through the live region. When the bar hides while Undo has focus, focus
  goes to the task input. After an undo, focus also goes to the input.
- Each task checkbox has `aria-describedby` pointing at its `<time>`. The compact text is `aria-hidden`; a visually hidden span gives the full date ("Added
  ..."), and the compact span has the same text as its `title`.
- `#clear-all` is disabled while a clear is running. The Clear all, Clear completed and Undo text buttons keep at least 24px of height.

## Accounts and the server

`npm start` runs `server/server.js`. It serves the four app files and a JSON API, using only built-in Node modules (`node:http`, `node:crypto`, `node:sqlite`),
so there is still nothing to install. It needs Node 22.13 or newer. The design it follows (requirements, data model, threat table, trade-offs) was written up
before the code; the choices below match it except where noted.

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

### Running the server

| Command | What it does |
| --- | --- |
| `npm start` | `node server/server.js`. |
| `npm run dev` | `node --watch server/server.js`. Restarts the server when a server file changes. |

A running server process keeps serving the API it started with. After you change server code, an old process still answers with the old routes, so use
`npm run dev` or restart it. Static files (`index.html`, `app.js` and the rest) are sent with `Cache-Control: no-cache`, so the browser asks again for them on
each load.

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

Tables: `users`, `password_credentials`, `sessions`, `auth_tokens` (email verification and password reset links), `todos` and `deleted_todos`. Deleting a user
deletes their rows in every other table. Passwords, session tokens and link tokens are never stored, only their hashes.

`deleted_todos` is the undo trash. It has the columns of `todos` (`id`, `user_id`, `text`, `done`, `created_at`, `position`) plus `batch` (a random id shared by
the tasks of one clear) and `deleted_at`. Clear all and Clear completed copy the tasks into it and delete them from `todos` in one transaction. Restoring copies
the batch back and deletes it from the trash. Rows older than `UNDO_WINDOW` (15 minutes) can no longer be restored and are purged (see Security). The table is
created with `CREATE TABLE IF NOT EXISTS`, so an existing database gets it on the next start.

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
| `PATCH /api/todos/:id` | `text` and/or `done` (at least one) | 200 `{ todo }`, or 404 `not_found` if it is not yours |
| `DELETE /api/todos/:id` | | 204, or 404 if it is not yours |
| `DELETE /api/todos` | `{ "confirm": "all" }` | 200 `{ removed, undo }`, or 400 `confirm_required` |
| `POST /api/todos/clear-completed` | | 200 `{ removed, undo }` |
| `POST /api/todos/restore` | `undo` | 200 `{ todos }` (the whole list), or 404 `undo_expired`, or 400 `undo_required` / `too_many_todos` |

`PATCH` checks `text` first. It is trimmed and must be 1 to 200 characters (counted as code points), else 400 `text_required` or `text_too_long`. `done`, if
sent, must be a boolean. A body with neither field, or with a `done` that is not a boolean, gets 400 `done_required`. A field that is not sent is left as it is,
and the task keeps its place in the list.

`undo` is the batch id of the cleared tasks, or `null` when nothing matched (nothing is stored then). It must be a non-empty string of at most 64 characters on
restore, else 400 `undo_required`. A batch that is unknown, belongs to another user, is older than 15 minutes or was already restored gives 404 `undo_expired`.
If restoring would pass 5000 tasks, nothing is restored and the answer is 400 `too_many_todos`. Restored tasks keep their ids, text, `done`, `createdAt` and
`position`, so they return to their original places, as in local mode. `createTodo` numbers a new task above both the live tasks and the unexpired trash, so
tasks added after the clear go after the restored ones.

The todo routes are rate limited per user, after the session check. A limited call gets 429 `too_many_requests` with a `Retry-After` header in seconds.

`user` is `{ id, email, emailVerified }`; `todo` is `{ id, text, done, createdAt }`. Change password and delete account have no
screens yet; they are API-only for now.

### Security

| Risk | What the server does |
| --- | --- |
| Stolen database | scrypt (N=2^17, r=8, p=1) with a random salt per password. Session and link tokens stored as SHA-256 hashes. |
| Session theft by script | Cookie is `HttpOnly` and `SameSite=Lax` (`Secure` and `__Host-` prefixed in production). The page never sees it. Content-Security-Policy allows only the app's own scripts plus the inline theme script by hash. |
| Cross-site requests (CSRF) | State-changing calls must be JSON, and are refused when `Origin` is another site or `Sec-Fetch-Site` is `cross-site`. |
| Session fixation | A new session token on every sign-in, password change and reset. |
| Guessing passwords | 20 sign-in attempts per IP per 10 minutes; 5 failures lock that email for 15 minutes. Limits on signup, reset and resend too. |
| Finding out who has an account | Same answer and similar timing for known and unknown emails on sign-in, sign-up and forgot-password. |
| Old sessions, trash | 24 hours idle (30 days with "Keep me signed in"), 90 days at most. Revoked on sign-out, password change and reset. Expired sessions, link tokens and trash are purged once at server startup and then hourly. |
| Email links | 256-bit random, single use, 24 hours (verify) or 30 minutes (reset); a newer link cancels the older one. Stripped from the address bar on arrival; `Referrer-Policy: no-referrer`. |
| Cleared tasks / undo | The undo token is a random UUID batch id, looked up only together with the user's id. Unknown, other users', expired and already restored batches all give the same 404 `undo_expired`. The 5000-task cap is checked before restoring. Clear all needs `{ "confirm": "all" }`. The batch id is stored as is, not hashed, because it works only with its owner's session. |
| Data kept after clearing | Cleared tasks stay in `deleted_todos` for 15 minutes. They are then purged at server startup, hourly, and on that user's next clear or restore. Deleting the account removes them at once. |
| Rate limits on tasks | Counted per user after sign-in. `todo-write`: 120 per minute (add, edit, delete one task). `todos-bulk`: 20 per 10 minutes (clear all, clear completed). `todos-restore`: 20 per 10 minutes. |

Differences from the design: scrypt instead of Argon2id (Node 22 has no built-in Argon2 and the project installs no packages); no breached-password check (it
needs a network call to Have I Been Pwned); a 15-minute lock after 5 failures rather than growing delays; rate-limit counters in memory, so they reset on
restart and are per process; account deletion is immediate rather than a 30-day soft delete; Sign in with Google is not built yet.

### Email

In development the server prints each email, with its link, in the terminal. To send real email, pass `createApp()` a `mailer` whose
`send({ to, subject, text })` calls your email provider.

## Tests

```bash
npm test
```

Runs `node --test` with no packages. These tests do not load the real page, so they cannot show that focus, dialogs, timers or layout work. Browser behavior is
covered by the Playwright suite below and by the manual list in [MANUAL-CHECKS.md](MANUAL-CHECKS.md).

### Browser tests

`tests/e2e/` is a Playwright suite with its own `package.json`. Its only dependency is `@playwright/test`, used for browser tests only; the root
`package.json` has no dependencies. Install it once:

```bash
npm --prefix tests/e2e install
```

| Command | What it does |
| --- | --- |
| `npm run test:e2e` | Headless run, tests in parallel, 30 s timeout per test. |
| `npm run test:e2e:headed` | Visible Edge window, one worker, `slowMo` of 400 ms, 120 s timeout per test. |

- The config (`tests/e2e/playwright.config.js`) uses the installed Microsoft Edge (`channel: 'msedge'`), so no browser is downloaded. The browser locale is
  `en-GB` and the time zone `Europe/Lisbon`.
- Each run starts its own server (`node server/server.js`) on port 3100 with a temporary database in the system temp folder. It never touches the server on
  port 3000 or `data/todo.db`, and it never reuses a server that is already running. Port 3100 must be free.
- The server runs with `TRUST_PROXY=1`. `openAccount()` in `tests/e2e/helpers.js` sends a different `X-Forwarded-For` for each new account, so the per-IP
  sign-up and sign-in limits do not stop a run.
- `openLocal()` makes `/api/auth/me` answer 404, so the page runs in local mode. `openAccount()` signs up a new account through the page.
- The Node tests do not load the real page, so the headed run (`npm run test:e2e:headed`) is the final check before a change is done.

Each server test starts the real HTTP server on a random port with an in-memory database and a fake clock, so expiry and
rate-limit windows are tested without waiting.

| File | Covers |
| --- | --- |
| `tests/units.test.js` | Hashing, password policy, secrets, rate limiter, cookie parsing, and page functions copied out of `app.js` into a vm sandbox (time label, `createTimeElement`, `createdAt` backfill, `ERROR_KEYS`) |
| `tests/auth.test.js` | Sign-up, sign-in, sessions and expiry, sign-out, verification, reset, change password, delete account, rate limits, purge |
| `tests/todos-and-security.test.js` | Todo routes including `PATCH` of `text` and `done` (validation, trimming, order kept), users kept apart, CSRF, bad bodies, static files, headers, production cookies |
| `tests/undo.test.js` | Clear all and clear completed with undo tokens, restore (order, ids, `createdAt`, positions, other users, expiry, the 5000 cap), `createdAt` in replies, the three todo rate limits, per-user and hourly trash purge, trash removed with the account, `deleted_todos` added to an existing database |
| `tests/translations.test.js` | Every language has every key the page uses |

## Known limitations

- The filter is not remembered across reloads.
- In local mode, data lives only in one browser on one device; clearing site data deletes the tasks.
- Tasks saved in local mode are not moved into an account when you sign in.
- Several tabs open at once do not sync; in account mode a reload shows the latest tasks.
- Edits are last-write-wins across tabs and devices.
- Escape is the only way to cancel an edit. Moving focus away saves it, so touch and switch users cannot cancel.
- In local mode the undo is kept in memory and is lost on reload.
- The startup purge in `server/server.js` is not covered by automated tests; the purge function it calls is.
- The browser tests run in Edge only and cover part of the page. The rest (themes, other languages, the 15-minute undo window, screen readers, touch) is checked
  by hand with [docs/MANUAL-CHECKS.md](MANUAL-CHECKS.md).
- Portuguese mixes European strings (newer) and Brazilian strings (older).
- Change password, sign out everywhere and delete account have API routes but no screens yet.
- The diagrams in `docs/diagrams/` show local mode.
