// TODO app. Runs in one of two modes, picked at startup:
// - account mode: served by the Node server (npm start). Users sign in, and tasks are
//   stored on the server per account. The session lives in an HttpOnly cookie that this
//   script never sees.
// - local mode: opened as a file or from a plain static server. No sign-in; tasks are
//   saved in this browser's localStorage, as before.
// The light/dark override and language are always saved in localStorage.
// Requires i18n.js to be loaded first (it defines TRANSLATIONS).

const STORAGE_KEYS = { todos: 'todo-items', theme: 'todo-theme', lang: 'todo-lang' };

const els = {
  form: document.getElementById('todo-form'),
  input: document.getElementById('todo-input'),
  list: document.getElementById('todo-list'),
  empty: document.getElementById('empty-message'),
  announcer: document.getElementById('announcer'),
  itemsLeft: document.getElementById('items-left'),
  clearCompleted: document.getElementById('clear-completed'),
  clearAll: document.getElementById('clear-all'),
  clearAllDialog: document.getElementById('clear-all-dialog'),
  clearAllMessage: document.getElementById('clear-all-message'),
  undoBar: document.getElementById('undo-bar'),
  undoMessage: document.getElementById('undo-message'),
  undoClear: document.getElementById('undo-clear'),
  filters: document.querySelectorAll('[data-filter]'),
  themeToggle: document.getElementById('theme-toggle'),
  languageSelect: document.getElementById('language-select'),
  todoView: document.getElementById('todo-view'),
  status: document.getElementById('status-message'),
  accountBar: document.getElementById('account-bar'),
  accountEmail: document.getElementById('account-email'),
  signOut: document.getElementById('sign-out'),
  verifyBanner: document.getElementById('verify-banner'),
  resendVerification: document.getElementById('resend-verification'),
  authView: document.getElementById('auth-view'),
  authHeading: document.getElementById('auth-heading'),
  authForm: document.getElementById('auth-form'),
  authEmailField: document.getElementById('auth-email-field'),
  authEmail: document.getElementById('auth-email'),
  authPasswordField: document.getElementById('auth-password-field'),
  authPasswordLabel: document.getElementById('auth-password-label'),
  authPassword: document.getElementById('auth-password'),
  authPasswordHint: document.getElementById('auth-password-hint'),
  authRememberField: document.getElementById('auth-remember-field'),
  authRemember: document.getElementById('auth-remember'),
  authError: document.getElementById('auth-error'),
  authSubmit: document.getElementById('auth-submit'),
  authSwitch: document.getElementById('auth-switch'),
  authForgot: document.getElementById('auth-forgot'),
};

let mode = null; // 'account' or 'local', set by start()
let user = null; // signed-in user in account mode: { id, email, emailVerified }
let todos = [];
let filter = 'all';
let lang = load(STORAGE_KEYS.lang, null) || detectLanguage();
let authMode = 'signin'; // 'signin' | 'signup' | 'forgot' | 'reset'
let resetToken = null;
let statusKey = null; // translation key of the message shown in the status line
let busy = false;
// Inline edit state. It lives here (not in the DOM) because render() rebuilds the list.
let editingId = null; // id of the task being edited, or null
let editDraft = ''; // what has been typed in the edit field so far
let editSaving = false; // true while the edit is being sent to the server
let editErrorShown = false; // a failed save left an error in the status line
let pendingEditId = null; // task whose Edit was clicked while another edit was still saving
let pointerDown = false; // a mouse button is held, so a click is still on its way
// Undo for Clear all / Clear completed: null, or { token, todos, messageKey, timer }.
// token is the server's undo token (account mode); todos is the list before the clear.
let undoState = null;
let undoing = false; // an undo request is in flight
// Account mode only: the server refuses an undo after 15 minutes (UNDO_WINDOW in server/app.js), so the bar
// goes a little earlier. In local mode there is no timer (WCAG 2.2.1); the bar stays until the next action.
const ACCOUNT_UNDO_WINDOW_MS = 15 * 60 * 1000 - 5000;

// ---------- storage ----------

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Storage may be unavailable (e.g. private mode); the app still works for this visit.
  }
}

// ---------- server API ----------

// Calls the server's JSON API. Throws an Error whose message is the server's error code
// (e.g. 'invalid_credentials') and whose status is the HTTP status (0 for network errors).
async function api(method, url, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    // Every state-changing call is JSON; the server refuses anything else (CSRF protection).
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body || {});
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const error = new Error('network_error');
    error.status = 0;
    throw error;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  if (!res.ok) {
    const error = new Error((data && data.error) || 'server_error');
    error.status = res.status;
    throw error;
  }
  return data;
}

const ERROR_KEYS = {
  invalid_credentials: 'errInvalidCredentials',
  invalid_email: 'errInvalidEmail',
  password_required: 'errPasswordTooShort',
  password_too_short: 'errPasswordTooShort',
  password_too_long: 'errPasswordTooLong',
  too_many_requests: 'errTooManyRequests',
  invalid_token: 'errInvalidToken',
  network_error: 'errNetwork',
  not_found: 'errTaskNotFound',
  undo_expired: 'errUndoExpired',
  too_many_todos: 'errTooManyTodos',
  confirm_required: 'errConfirmRequired',
  undo_required: 'errUndoRequired',
};

function errorKey(error) {
  return ERROR_KEYS[error.message] || 'errGeneric';
}

// ---------- language ----------

function detectLanguage() {
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return TRANSLATIONS[browser] ? browser : 'en';
}

function t(key) {
  return (TRANSLATIONS[lang] || TRANSLATIONS.en)[key];
}

// The Intl locale for the page language. Portuguese is European Portuguese.
function intlLocale() {
  return lang === 'pt' ? 'pt-PT' : lang;
}

function applyLanguage() {
  document.documentElement.lang = lang;
  els.languageSelect.value = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  });
  document.title = t('title');
  renderAuth();
  renderStatus();
  render();
}

// ---------- theme ----------

// The page follows the system color scheme unless the user picked the other one. The choice
// lives in <meta name="color-scheme"> ('light dark' = follow the system); the CSS reads it from
// there, including which of the toggle's two icons and labels is shown.
const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme(override) {
  colorSchemeMeta.content = override === 'light' || override === 'dark' ? override : 'light dark';
}

function toggleTheme() {
  const system = systemDark.matches ? 'dark' : 'light';
  const current = colorSchemeMeta.content === 'light dark' ? system : colorSchemeMeta.content;
  const target = current === 'dark' ? 'light' : 'dark';
  // Picking the system's own scheme undoes the override, so the page follows the system again.
  if (target === system) {
    try {
      localStorage.removeItem(STORAGE_KEYS.theme);
    } catch (e) {
      // Storage may be unavailable; the scheme still changes for this visit.
    }
    applyTheme(null);
  } else {
    save(STORAGE_KEYS.theme, target);
    applyTheme(target);
  }
}

// ---------- status line ----------

function showStatus(key, kind) {
  statusKey = key;
  els.status.classList.toggle('error', kind === 'error');
  renderStatus();
}

function clearStatus() {
  statusKey = null;
  renderStatus();
}

function renderStatus() {
  els.status.hidden = !statusKey;
  els.status.textContent = statusKey ? t(statusKey) : '';
}

// Reads a short confirmation ("Task added.") to screen reader users through a hidden live
// region. It is emptied first so the same message is announced again when repeated.
function announce(key) {
  els.announcer.textContent = '';
  setTimeout(() => {
    els.announcer.textContent = t(key);
  }, 50);
}

// When the focused control has just been hidden (a screen changed, or the button removed
// itself), move focus to a sensible place instead of leaving it on the page body.
function rescueFocus(target) {
  const active = document.activeElement;
  if (!active || active === document.body || active.closest('[hidden]')) target.focus();
}

// Shows an API error. A 401 means the session ended, so go back to the sign-in screen.
function handleApiError(error) {
  if (error.status === 401 && mode === 'account') {
    signedOut();
    showStatus('sessionExpired', 'error');
    rescueFocus(els.authEmail);
    return;
  }
  showStatus(errorKey(error), 'error');
}

// ---------- todos ----------

// ---------- undo ----------

function showUndo(snapshot, token, messageKey) {
  hideUndo();
  undoState = {
    token,
    todos: snapshot,
    messageKey,
    timer: mode === 'account' ? setTimeout(hideUndo, ACCOUNT_UNDO_WINDOW_MS) : null,
  };
  renderUndo();
}

function hideUndo() {
  if (undoState) clearTimeout(undoState.timer);
  // Focus on Undo would be lost with the bar, so it goes to the task input.
  const hadFocus = undoState && els.undoBar.contains(document.activeElement);
  undoState = null;
  renderUndo();
  if (hadFocus) els.input.focus();
}

// Shows the undo bar after a clear and moves focus to Undo if the control that had focus is gone.
// Focus on Undo reads the message (aria-describedby), so announce() is only needed when focus stays put.
function offerUndo(snapshot, token, messageKey) {
  showUndo(snapshot, token, messageKey);
  rescueFocus(els.undoClear);
  if (document.activeElement !== els.undoClear) announce(messageKey);
}

function renderUndo() {
  els.undoBar.hidden = !undoState;
  els.undoMessage.textContent = undoState ? t(undoState.messageKey) : '';
}

// Puts the cleared tasks back. In account mode the server restores them from its own copy.
async function undoClear() {
  if (!undoState || undoing) return;
  undoing = true;
  try {
    if (mode === 'account') {
      const data = await api('POST', '/api/todos/restore', { undo: undoState.token });
      todos = data.todos;
    } else {
      todos = undoState.todos;
      save(STORAGE_KEYS.todos, todos);
    }
  } catch (error) {
    // The token is no longer valid, so the bar has nothing left to offer.
    if (error.message === 'undo_expired') hideUndo();
    throw error;
  } finally {
    undoing = false;
  }
  render();
  announce('tasksRestored');
  hideUndo();
  els.input.focus();
}

// ---------- todos ----------

async function addTodo(text) {
  hideUndo();
  if (mode === 'account') {
    const { todo } = await api('POST', '/api/todos', { text });
    todos.push(todo);
  } else {
    // The id is the time in base 36 plus 4 random characters; backfillCreatedAt() relies on that.
    const now = Date.now();
    todos.push({ id: now.toString(36) + Math.random().toString(36).slice(2, 6).padEnd(4, '0'), text, done: false, createdAt: now });
    save(STORAGE_KEYS.todos, todos);
  }
  render();
  announce('taskAdded');
}

async function toggleTodo(id) {
  hideUndo();
  const todo = todos.find((item) => item.id === id);
  if (!todo) return;
  if (mode === 'account') {
    const { todo: updated } = await api('PATCH', `/api/todos/${encodeURIComponent(id)}`, { done: !todo.done });
    todo.done = updated.done;
  } else {
    todo.done = !todo.done;
    save(STORAGE_KEYS.todos, todos);
  }
  render();
  announce(todo.done ? 'taskCompleted' : 'taskReopened');
}

// Changes a task's text. Like the other actions it is not optimistic: in account mode the
// task changes only once the server has accepted the new text.
async function editTodo(id, text) {
  hideUndo();
  const todo = todos.find((item) => item.id === id);
  if (!todo) return;
  if (mode === 'account') {
    const { todo: updated } = await api('PATCH', `/api/todos/${encodeURIComponent(id)}`, { text });
    todo.text = updated.text;
  } else {
    todo.text = text;
    save(STORAGE_KEYS.todos, todos);
  }
  // The edit is over once it is saved, so the row goes back to its normal form.
  editingId = null;
  editDraft = '';
  render();
  announce('taskEdited');
}

function focusEditField() {
  const field = els.list.querySelector('[data-control="edit-field"]');
  if (field) field.focus();
  return field;
}

// Puts keyboard focus back on a row's Edit button after its edit ended with Enter or Escape.
function focusControl(ref) {
  if (!ref) return;
  const row = els.list.querySelector(`li[data-id="${CSS.escape(ref.id)}"]`);
  const target = row && row.querySelector(`[data-control="${ref.control}"]`);
  if (target) target.focus();
}

function focusEditButton(id) {
  const row = els.list.querySelector(`li[data-id="${CSS.escape(id)}"]`);
  const button = row && row.querySelector('[data-control="edit"]');
  (button || els.input).focus();
}

function startEdit(id) {
  if (editSaving) return;
  // Starting a second edit finishes the first one the same way leaving its field would.
  if (editingId !== null && editingId !== id) {
    commitEdit('blur');
    if (editSaving) {
      pendingEditId = id; // opened once the save above has finished
      return;
    }
  }
  if (editingId === id) return;
  const todo = todos.find((item) => item.id === id);
  if (!todo) return;
  editingId = id;
  editDraft = todo.text;
  render();
  const field = focusEditField();
  if (field) field.select();
}

function cancelEdit() {
  editingId = null;
  editDraft = '';
  if (statusKey === 'errTaskEmpty') clearStatus();
  render();
}

// Ends the edit in the open field. source is 'enter' or 'blur'.
// refocus ({ id, control }) is where keyboard focus goes once the field is gone, when the user
// left the field for another control.
function commitEdit(source, refocus) {
  if (editingId === null || editSaving) return;
  const id = editingId;
  const todo = todos.find((item) => item.id === id);
  const text = editDraft.trim();
  if (!todo || text === todo.text) {
    cancelEdit();
    focusControl(refocus);
    return;
  }
  if (!text) {
    if (source === 'blur') {
      cancelEdit();
      focusControl(refocus);
      return;
    }
    // Enter on an empty field: keep it open and say why nothing happened.
    const field = els.list.querySelector('[data-control="edit-field"]');
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', 'edit-hint status-message');
    }
    if (statusKey === 'errTaskEmpty') {
      // Same text again: empty the line first so the live region announces it once more.
      els.status.textContent = '';
      setTimeout(() => {
        if (statusKey === 'errTaskEmpty') renderStatus();
      }, 50);
    } else {
      showStatus('errTaskEmpty', 'error');
    }
    return;
  }

  editSaving = true;
  const field = els.list.querySelector('[data-control="edit-field"]');
  if (field) field.readOnly = true;
  let saved = true;
  run(async () => {
    try {
      await editTodo(id, text);
    } catch (error) {
      saved = false;
      if (error.message === 'not_found') {
        // Gone from the server (deleted elsewhere), so drop it here too.
        todos = todos.filter((item) => item.id !== id);
        if (editingId === id) {
          editingId = null;
          editDraft = '';
        }
        render();
      }
      throw error;
    }
  }).then(() => {
    editSaving = false;
    if (saved) {
      if (editErrorShown) clearStatus();
      editErrorShown = false;
      if (source === 'enter') focusEditButton(id);
      focusControl(refocus);
      // An Edit click on another row arrived while this save ran; open that row now.
      if (pendingEditId !== null) {
        const next = pendingEditId;
        pendingEditId = null;
        startEdit(next);
      }
      return;
    }
    pendingEditId = null;
    editErrorShown = true;
    // Failed: keep the field open with the typed text so it can be retried or cancelled.
    const open = els.list.querySelector('[data-control="edit-field"]');
    if (editingId === id && open) {
      open.readOnly = false;
      if (source === 'enter') open.focus();
    }
  });
}

async function deleteTodo(id) {
  hideUndo();
  if (mode === 'account') {
    await api('DELETE', `/api/todos/${encodeURIComponent(id)}`);
  }
  todos = todos.filter((item) => item.id !== id);
  if (mode === 'local') save(STORAGE_KEYS.todos, todos);
  render();
  announce('taskDeleted');
}

async function clearCompletedTodos() {
  hideUndo();
  const snapshot = todos.slice();
  let token = null;
  if (mode === 'account') {
    ({ undo: token } = await api('POST', '/api/todos/clear-completed'));
  }
  todos = todos.filter((item) => !item.done);
  if (mode === 'local') save(STORAGE_KEYS.todos, todos);
  render();
  // Nothing removed means nothing to undo; in account mode Undo also needs the server's token.
  if (todos.length < snapshot.length && (mode === 'local' || token)) offerUndo(snapshot, token, 'completedCleared');
  else announce('completedCleared');
}

async function clearAllTodos() {
  hideUndo();
  const snapshot = todos.slice();
  let token = null;
  els.clearAll.disabled = true; // the dialog cannot be reopened while the request is in flight
  try {
    if (mode === 'account') {
      ({ undo: token } = await api('DELETE', '/api/todos', { confirm: 'all' }));
    }
  } finally {
    els.clearAll.disabled = false;
  }
  todos = [];
  if (mode === 'local') save(STORAGE_KEYS.todos, todos);
  resetEdit();
  render();
  if (snapshot.length && (mode === 'local' || token)) {
    // The Clear all button has just hidden itself, so focus goes to Undo unless the user moved elsewhere.
    offerUndo(snapshot, token, 'allCleared');
  } else {
    announce('allCleared');
    els.input.focus();
  }
}

// ---------- time added ----------

const formatters = {}; // Intl formatters, built once per locale

function formatter(key, create) {
  const cacheKey = intlLocale() + '|' + key;
  if (!formatters[cacheKey]) formatters[cacheKey] = create(intlLocale());
  return formatters[cacheKey];
}

// Compact text for when a task was added: "now", "5 min", "14:32", "3 Mar", "3 Mar 2025".
function formatAddedAt(ms) {
  const date = new Date(ms);
  const now = new Date();
  const minutes = Math.floor((now.getTime() - ms) / 60000);
  if (minutes < 1) return t('timeNow');
  if (minutes < 60) {
    return formatter('minute', (loc) => new Intl.NumberFormat(loc, { style: 'unit', unit: 'minute', unitDisplay: 'short' })).format(minutes);
  }
  if (date.toDateString() === now.toDateString()) {
    return formatter('time', (loc) => new Intl.DateTimeFormat(loc, { timeStyle: 'short' })).format(date);
  }
  if (date.getFullYear() === now.getFullYear()) {
    return formatter('day', (loc) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short' })).format(date);
  }
  return formatter('year', (loc) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', year: 'numeric' })).format(date);
}

// The <time> element at the end of a row, or null for a task without a creation time.
function createTimeElement(item, index) {
  const ms = item.createdAt;
  // A corrupt value (a string, 1e20, NaN) must not make render() throw in toISOString().
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const full = formatter('full', (loc) => new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short' }));
  const fullText = t('addedOn')(full.format(date));

  const time = document.createElement('time');
  time.className = 'todo-time';
  time.id = `todo-time-${index}`;
  time.dateTime = date.toISOString();
  // Sighted users see the short text (full date on hover); screen readers get the absolute one.
  const short = document.createElement('span');
  short.className = 'todo-time-short';
  short.setAttribute('aria-hidden', 'true');
  short.title = fullText;
  short.textContent = formatAddedAt(ms);
  const hidden = document.createElement('span');
  hidden.className = 'visually-hidden';
  hidden.textContent = fullText;
  time.append(short, hidden);
  return time;
}

// Keeps "5 min" current. It only rewrites the short text, never calls render(), so an open edit is left alone.
function refreshTaskTimes() {
  if (document.hidden) return;
  els.list.querySelectorAll('.todo-time .todo-time-short').forEach((short) => {
    const ms = Date.parse(short.parentElement.dateTime);
    if (Number.isNaN(ms)) return;
    const text = formatAddedAt(ms);
    if (short.textContent !== text) short.textContent = text;
  });
}

// Tasks saved before createdAt existed get it from their id (time in base 36 + 4 random characters).
function backfillCreatedAt(list) {
  const min = Date.UTC(2020, 0, 1);
  const max = Date.now() + 86400000;
  let changed = false;
  list.forEach((item) => {
    if (typeof item.createdAt === 'number') return;
    const ms = parseInt(String(item.id).slice(0, -4), 36);
    if (ms >= min && ms <= max) {
      item.createdAt = ms;
      changed = true;
    }
  });
  if (changed) save(STORAGE_KEYS.todos, list);
}

function resetEdit() {
  editingId = null;
  editDraft = '';
  editSaving = false;
  editErrorShown = false;
  pendingEditId = null;
}

// Runs a todo action, showing any server error instead of failing silently.
function run(action) {
  // A new action replaces an error left by an earlier one. The edit field clears its own empty-text error.
  if (els.status.classList.contains('error') && statusKey !== 'errTaskEmpty') clearStatus();
  return action().catch(handleApiError);
}

document.addEventListener('mousedown', () => {
  pointerDown = true;
}, true);
document.addEventListener('mouseup', () => {
  setTimeout(() => {
    pointerDown = false;
  }, 0);
}, true);

// The text field that replaces a row while its task is being edited.
function createEditField(id) {
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'todo-edit';
  field.dataset.control = 'edit-field';
  field.maxLength = 200;
  field.autocomplete = 'off';
  field.enterKeyHint = 'done';
  field.value = editDraft;
  field.readOnly = editSaving;
  field.setAttribute('aria-label', t('editTask'));
  if (statusKey === 'errTaskEmpty') {
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', 'edit-hint status-message');
  } else {
    field.setAttribute('aria-describedby', 'edit-hint');
  }

  field.addEventListener('input', () => {
    editDraft = field.value;
    field.removeAttribute('aria-invalid');
    field.setAttribute('aria-describedby', 'edit-hint');
    if (statusKey === 'errTaskEmpty') clearStatus();
  });
  let composing = false; // an IME composition is in progress
  field.addEventListener('compositionstart', () => {
    composing = true;
  });
  field.addEventListener('compositionend', () => {
    // Safari sends the closing Enter keydown after this event, so stay "composing" a moment.
    setTimeout(() => {
      composing = false;
    }, 0);
  });
  field.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229 || composing) return;
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    if (editSaving) return;
    if (event.key === 'Enter') {
      commitEdit('enter');
      // Saving continues in the background; an empty or unchanged field is settled right here.
      if (editingId === null) focusEditButton(id);
    } else {
      cancelEdit();
      focusEditButton(id);
    }
  });
  // Leaving the field saves it. A field that render() just removed must not save again.
  field.addEventListener('blur', (event) => {
    if (!field.isConnected || editingId !== id || editSaving) return;
    const next = event.relatedTarget;
    const nextRow = next && els.list.contains(next) ? next.closest('li') : null;
    if (!nextRow || !next.dataset.control) {
      commitEdit('blur');
      return;
    }
    // Focus is moving to another control in the list. Saving rebuilds the list, which would
    // destroy that control (and a click on it) mid-gesture, so wait until the click has landed.
    const refocus = { id: nextRow.dataset.id, control: next.dataset.control };
    const settle = () => {
      setTimeout(() => {
        if (editingId === id && !editSaving) commitEdit('blur', refocus);
      }, 0);
    };
    if (pointerDown) document.addEventListener('mouseup', settle, { once: true });
    else settle();
  });
  return field;
}

function render() {
  const visible = todos.filter((item) =>
    filter === 'active' ? !item.done : filter === 'completed' ? item.done : true
  );

  // The list is rebuilt from scratch, which would drop keyboard focus on the page body.
  // Remember which control in which row had focus so it can be put back afterwards.
  const active = document.activeElement;
  const focusedRow = els.list.contains(active) ? active.closest('li') : null;
  const focused = focusedRow && {
    id: focusedRow.dataset.id,
    control: active.dataset.control,
    index: [...els.list.children].indexOf(focusedRow),
  };

  // An edit cannot outlive its task (deleted, or hidden by the filter).
  if (editingId !== null && !visible.some((item) => item.id === editingId)) {
    editingId = null;
    editDraft = '';
  }

  els.list.innerHTML = '';
  visible.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (item.done ? ' done' : '');
    li.dataset.id = item.id;

    if (item.id === editingId) {
      li.append(createEditField(item.id));
      els.list.appendChild(li);
      return;
    }

    // Each control is named after its task ("Buy milk", "Delete Buy milk") so screen reader
    // users can tell the rows apart.
    const textId = `todo-text-${index}`;
    const editId = `todo-edit-${index}`;
    const deleteId = `todo-delete-${index}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;
    checkbox.dataset.control = 'toggle';
    checkbox.setAttribute('aria-labelledby', textId);
    checkbox.addEventListener('change', () => run(() => toggleTodo(item.id)).then(render));

    const span = document.createElement('span');
    span.id = textId;
    span.className = 'todo-text';
    span.textContent = item.text;
    span.addEventListener('dblclick', () => startEdit(item.id));

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.id = editId;
    edit.className = 'edit-button';
    edit.dataset.control = 'edit';
    edit.title = t('edit');
    edit.setAttribute('aria-labelledby', `${editId} ${textId}`);
    const editIcon = document.createElement('span');
    editIcon.setAttribute('aria-hidden', 'true');
    editIcon.textContent = '✎';
    const editLabel = document.createElement('span');
    editLabel.className = 'visually-hidden';
    editLabel.textContent = t('edit');
    edit.append(editIcon, editLabel);
    edit.addEventListener('click', () => startEdit(item.id));

    const del = document.createElement('button');
    del.type = 'button';
    del.id = deleteId;
    del.className = 'delete-button';
    del.dataset.control = 'delete';
    del.title = t('delete');
    del.setAttribute('aria-labelledby', `${deleteId} ${textId}`);
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✕';
    const label = document.createElement('span');
    label.className = 'visually-hidden';
    label.textContent = t('delete');
    del.append(icon, label);
    del.addEventListener('click', () => run(() => deleteTodo(item.id)));

    const time = createTimeElement(item, index);
    if (time) checkbox.setAttribute('aria-describedby', time.id);

    li.append(checkbox, span);
    if (time) li.append(time);
    li.append(edit, del);
    els.list.appendChild(li);
  });

  if (focused) {
    // Same row if it is still shown, else the row that took its place, else the task input.
    const rows = els.list.children;
    const row = els.list.querySelector(`li[data-id="${CSS.escape(focused.id)}"]`) || rows[Math.min(focused.index, rows.length - 1)];
    const target = row && row.querySelector(`[data-control="${focused.control}"]`);
    (target || els.input).focus();
  }

  els.empty.hidden = visible.length > 0;
  els.itemsLeft.textContent = t('itemsLeft')(todos.filter((item) => !item.done).length);
  els.clearCompleted.hidden = !todos.some((item) => item.done);
  els.clearAll.hidden = todos.length === 0;
  renderUndo();
  els.filters.forEach((btn) => btn.setAttribute('aria-pressed', String(btn.dataset.filter === filter)));
}

// ---------- account: screens ----------

const AUTH_TEXT = {
  signin: { heading: 'signInHeading', submit: 'signIn', switchTo: 'signup', switchLabel: 'noAccount' },
  signup: { heading: 'signUpHeading', submit: 'signUp', switchTo: 'signin', switchLabel: 'haveAccount' },
  forgot: { heading: 'forgotHeading', submit: 'sendResetLink', switchTo: 'signin', switchLabel: 'backToSignIn' },
  reset: { heading: 'resetHeading', submit: 'setNewPassword', switchTo: 'signin', switchLabel: 'backToSignIn' },
};

function setAuthMode(next) {
  authMode = next;
  els.authError.hidden = true;
  els.authPassword.value = '';
  // Start the new screen without leftover "invalid" marks from the previous one.
  [els.authEmail, els.authPassword].forEach((input) => input.removeAttribute('aria-invalid'));
  renderAuth();
}

function renderAuth() {
  const text = AUTH_TEXT[authMode];
  const choosingPassword = authMode === 'signup' || authMode === 'reset';
  els.authHeading.textContent = t(text.heading);
  els.authSubmit.textContent = t(text.submit);
  els.authSwitch.textContent = t(text.switchLabel);
  els.authEmailField.hidden = authMode === 'reset';
  els.authEmail.required = authMode !== 'reset';
  els.authPasswordField.hidden = authMode === 'forgot';
  els.authPassword.required = authMode !== 'forgot';
  els.authPasswordLabel.textContent = t(authMode === 'reset' ? 'newPassword' : 'password');
  els.authPassword.autocomplete = choosingPassword ? 'new-password' : 'current-password';
  els.authPassword.minLength = choosingPassword ? 8 : 0;
  els.authPasswordHint.hidden = !choosingPassword;
  if (choosingPassword) els.authPassword.setAttribute('aria-describedby', els.authPasswordHint.id);
  else els.authPassword.removeAttribute('aria-describedby');
  els.authRememberField.hidden = authMode === 'forgot' || authMode === 'reset';
  els.authForgot.hidden = authMode !== 'signin';
  if (!els.authError.hidden && els.authError.dataset.key) els.authError.textContent = t(els.authError.dataset.key);
}

function showAuthError(key) {
  els.authError.dataset.key = key;
  els.authError.textContent = t(key);
  els.authError.hidden = false;
}

function showAuthView() {
  els.todoView.hidden = true;
  els.accountBar.hidden = true;
  els.verifyBanner.hidden = true;
  els.authView.hidden = false;
  renderAuth();
}

async function signedIn(signedInUser) {
  user = signedInUser;
  resetToken = null;
  els.authForm.reset();
  els.authError.hidden = true;
  els.authView.hidden = true;
  els.accountEmail.textContent = user.email;
  els.accountBar.hidden = false;
  els.verifyBanner.hidden = user.emailVerified;
  todos = [];
  filter = 'all';
  hideUndo();
  resetEdit();
  render();
  els.todoView.hidden = false;
  try {
    todos = (await api('GET', '/api/todos')).todos;
    render();
  } catch (error) {
    handleApiError(error);
  }
}

function signedOut() {
  user = null;
  todos = [];
  hideUndo();
  resetEdit();
  render();
  setAuthMode('signin');
  showAuthView();
}

// ---------- account: actions ----------

async function submitAuth() {
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const remember = els.authRemember.checked;

  if (authMode === 'signin') {
    const { user: me } = await api('POST', '/api/auth/login', { email, password, remember });
    clearStatus();
    await signedIn(me);
    rescueFocus(els.input);
  } else if (authMode === 'signup') {
    await api('POST', '/api/auth/signup', { email, password });
    // The server answers the same way for new and taken emails, so sign in next.
    const { user: me } = await api('POST', '/api/auth/login', { email, password, remember });
    clearStatus();
    await signedIn(me);
    rescueFocus(els.input);
  } else if (authMode === 'forgot') {
    await api('POST', '/api/auth/password/forgot', { email });
    setAuthMode('signin');
    showStatus('resetSent');
  } else if (authMode === 'reset') {
    const { user: me } = await api('POST', '/api/auth/password/reset', { token: resetToken, password });
    await signedIn(me);
    showStatus('passwordChanged');
    rescueFocus(els.input);
  }
}

async function signOut() {
  try {
    await api('POST', '/api/auth/logout');
  } catch (error) {
    // Signed out on this screen either way; the cookie was cleared or the session had already ended.
  }
  clearStatus();
  signedOut();
  rescueFocus(els.authEmail);
}

async function resendVerification() {
  try {
    await api('POST', '/api/auth/resend-verification');
    showStatus('verificationSent');
  } catch (error) {
    handleApiError(error);
  }
}

async function verifyEmail(token) {
  try {
    await api('POST', '/api/auth/verify-email', { token });
    showStatus('emailVerified');
    if (user) {
      user.emailVerified = true;
      els.verifyBanner.hidden = true;
    }
  } catch (error) {
    showStatus(errorKey(error), 'error');
  }
}

// ---------- startup ----------

// Account mode if the API answers (signed in or not); local mode when there is no server,
// such as when index.html is opened as a file or served by a plain static server.
async function detectMode() {
  if (location.protocol === 'file:') return { mode: 'local' };
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (res.status === 200) return { mode: 'account', user: (await res.json()).user };
    if (res.status === 401 || res.status >= 500) return { mode: 'account', user: null, serverError: res.status >= 500 };
    return { mode: 'local' };
  } catch (e) {
    return { mode: 'local' };
  }
}

async function start() {
  applyLanguage();

  // Email links arrive as ?verify=<token> or ?reset=<token>. Take the token, then
  // remove it from the address bar and history.
  const params = new URLSearchParams(location.search);
  const verifyToken = params.get('verify');
  resetToken = params.get('reset');
  if (verifyToken || resetToken) history.replaceState(null, '', location.pathname);

  const detected = await detectMode();
  mode = detected.mode;

  if (mode === 'local') {
    todos = load(STORAGE_KEYS.todos, []);
    backfillCreatedAt(todos);
    render();
    els.todoView.hidden = false;
    return;
  }

  if (detected.serverError) showStatus('errGeneric', 'error');
  if (verifyToken) {
    user = detected.user;
    await verifyEmail(verifyToken);
  }
  if (resetToken) {
    setAuthMode('reset');
    showAuthView();
  } else if (detected.user) {
    await signedIn(detected.user);
  } else {
    showAuthView();
  }
}

// ---------- events ----------

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  run(async () => {
    await addTodo(text);
    els.input.value = '';
  }).then(() => els.input.focus());
});

els.filters.forEach((btn) =>
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    render();
  })
);

// The button hides itself once nothing is completed, so focus moves to the task input.
els.clearCompleted.addEventListener('click', () => run(clearCompletedTodos).then(() => rescueFocus(els.input)));

els.clearAll.addEventListener('click', () => {
  els.clearAllMessage.textContent = t('clearAllConfirm')(todos.length);
  els.clearAllDialog.returnValue = ''; // a previous Confirm must not survive an Escape
  els.clearAllDialog.showModal();
});

// Escape and Cancel close the dialog with another returnValue, so only Confirm clears.
els.clearAllDialog.addEventListener('close', () => {
  if (els.clearAllDialog.returnValue === 'confirm') run(clearAllTodos);
});

els.undoClear.addEventListener('click', () => run(undoClear));

setInterval(refreshTaskTimes, 60000);
document.addEventListener('visibilitychange', refreshTaskTimes);

els.themeToggle.addEventListener('click', toggleTheme);

// Keep the scheme in step when it is changed in another tab.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEYS.theme) applyTheme(load(STORAGE_KEYS.theme, null));
});

// Mark auth fields invalid for screen readers at the same moment CSS shows them as invalid
// (:user-invalid, i.e. only after the user has left the field or tried to submit).
function syncInvalid(event) {
  const input = event.target;
  if (!input.matches || !input.matches('#auth-form input:not([type="checkbox"])')) return;
  if (event.type === 'input' && input.getAttribute('aria-invalid') !== 'true') return;
  if (input.matches(':user-invalid')) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}
if (CSS.supports('selector(:user-invalid)')) {
  els.authForm.addEventListener('blur', syncInvalid, true);
  els.authForm.addEventListener('input', syncInvalid);
  // A submit attempt marks every invalid field at once; 'invalid' does not bubble, so capture it.
  els.authForm.addEventListener('invalid', (event) => event.target.setAttribute('aria-invalid', 'true'), true);
  els.authForm.addEventListener('reset', () => {
    els.authForm.querySelectorAll('[aria-invalid]').forEach((input) => input.removeAttribute('aria-invalid'));
  });
}

els.languageSelect.addEventListener('change', () => {
  lang = els.languageSelect.value;
  save(STORAGE_KEYS.lang, lang);
  applyLanguage();
});

els.authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  els.authSubmit.disabled = true;
  els.authError.hidden = true;
  try {
    await submitAuth();
  } catch (error) {
    showAuthError(errorKey(error));
  } finally {
    busy = false;
    els.authSubmit.disabled = false;
  }
});

// Switching screens starts the user at the new screen's first field.
els.authSwitch.addEventListener('click', () => {
  clearStatus();
  setAuthMode(AUTH_TEXT[authMode].switchTo);
  els.authEmail.focus();
});

els.authForgot.addEventListener('click', () => {
  clearStatus();
  setAuthMode('forgot');
  els.authEmail.focus();
});

els.signOut.addEventListener('click', signOut);
els.resendVerification.addEventListener('click', resendVerification);

start();
