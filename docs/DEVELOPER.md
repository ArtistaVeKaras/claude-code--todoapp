# Developer documentation

This document describes how the TODO app is built. For features and how to run it, see the [README](../README.md).

The app is plain HTML, CSS and JavaScript. There is no build step, no dependencies and no backend. Scripts are loaded as classic `<script>` tags, so everything shares one global scope.

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

1. `todos` is loaded from storage (default `[]`).
2. `lang` comes from storage, otherwise `detectLanguage()`.
3. `theme` comes from storage, otherwise `detectTheme()`.
4. Event listeners are attached.
5. `applyLanguage()` runs at the end of the file. It sets the page language, translates the page, applies the theme and calls `render()`.

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

- `addTodo(text)`: appends a new task, saves and re-renders.
- `toggleTodo(id)`: flips `done` for the matching task, saves and re-renders.
- `deleteTodo(id)`: removes the matching task, saves and re-renders.
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

`TRANSLATIONS` maps a language code to an object with these keys:

`title`, `language`, `placeholder`, `add`, `all`, `active`, `completed`, `empty`, `clearCompleted`, `delete`, `toggleTask`, `itemsLeft`, `darkMode`, `lightMode`.

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

## Known limitations

- Tasks cannot be edited after they are added.
- The filter is not remembered across reloads.
- Data lives only in one browser on one device; clearing site data deletes the tasks.
- Several tabs open at once do not sync; the last tab to save wins.
- There are no automated tests.
