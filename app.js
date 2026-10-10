// TODO app. Runs in one of two modes, picked at startup:
// - account mode: served by the Node server (npm start). Users sign in, and tasks are
//   stored on the server per account. The session lives in an HttpOnly cookie that this
//   script never sees.
// - local mode: opened as a file or from a plain static server. No sign-in; tasks are
//   saved in this browser's localStorage, as before.
// Theme and language are always saved in localStorage.
// Requires i18n.js to be loaded first (it defines TRANSLATIONS).

const STORAGE_KEYS = { todos: 'todo-items', theme: 'todo-theme', lang: 'todo-lang' };

const els = {
  form: document.getElementById('todo-form'),
  input: document.getElementById('todo-input'),
  list: document.getElementById('todo-list'),
  empty: document.getElementById('empty-message'),
  itemsLeft: document.getElementById('items-left'),
  clearCompleted: document.getElementById('clear-completed'),
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
let theme = load(STORAGE_KEYS.theme, null) || detectTheme();
let authMode = 'signin'; // 'signin' | 'signup' | 'forgot' | 'reset'
let resetToken = null;
let statusKey = null; // translation key of the message shown in the status line
let busy = false;

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

function applyLanguage() {
  document.documentElement.lang = lang;
  els.languageSelect.value = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.title = t('title');
  applyTheme();
  renderAuth();
  renderStatus();
  render();
}

// ---------- theme ----------

function detectTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  els.themeToggle.textContent = isDark ? '☀️' : '🌙';
  const label = isDark ? t('lightMode') : t('darkMode');
  els.themeToggle.setAttribute('aria-label', label);
  els.themeToggle.title = label;
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

// Shows an API error. A 401 means the session ended, so go back to the sign-in screen.
function handleApiError(error) {
  if (error.status === 401 && mode === 'account') {
    signedOut();
    showStatus('sessionExpired', 'error');
    return;
  }
  showStatus(errorKey(error), 'error');
}

// ---------- todos ----------

async function addTodo(text) {
  if (mode === 'account') {
    const { todo } = await api('POST', '/api/todos', { text });
    todos.push(todo);
  } else {
    todos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false });
    save(STORAGE_KEYS.todos, todos);
  }
  render();
}

async function toggleTodo(id) {
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
}

async function deleteTodo(id) {
  if (mode === 'account') {
    await api('DELETE', `/api/todos/${encodeURIComponent(id)}`);
  }
  todos = todos.filter((item) => item.id !== id);
  if (mode === 'local') save(STORAGE_KEYS.todos, todos);
  render();
}

async function clearCompletedTodos() {
  if (mode === 'account') {
    await api('POST', '/api/todos/clear-completed');
  }
  todos = todos.filter((item) => !item.done);
  if (mode === 'local') save(STORAGE_KEYS.todos, todos);
  render();
}

// Runs a todo action, showing any server error instead of failing silently.
function run(action) {
  return action().catch(handleApiError);
}

function render() {
  const visible = todos.filter((item) =>
    filter === 'active' ? !item.done : filter === 'completed' ? item.done : true
  );

  els.list.innerHTML = '';
  visible.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'todo-item' + (item.done ? ' done' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;
    checkbox.setAttribute('aria-label', t('toggleTask'));
    checkbox.addEventListener('change', () => run(() => toggleTodo(item.id)).then(render));

    const span = document.createElement('span');
    span.className = 'todo-text';
    span.textContent = item.text;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-button';
    del.textContent = '✕';
    del.setAttribute('aria-label', t('delete'));
    del.title = t('delete');
    del.addEventListener('click', () => run(() => deleteTodo(item.id)));

    li.append(checkbox, span, del);
    els.list.appendChild(li);
  });

  els.empty.hidden = visible.length > 0;
  els.itemsLeft.textContent = t('itemsLeft')(todos.filter((item) => !item.done).length);
  els.clearCompleted.hidden = !todos.some((item) => item.done);
  els.filters.forEach((btn) => btn.classList.toggle('active', btn.dataset.filter === filter));
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
  } else if (authMode === 'signup') {
    await api('POST', '/api/auth/signup', { email, password });
    // The server answers the same way for new and taken emails, so sign in next.
    const { user: me } = await api('POST', '/api/auth/login', { email, password, remember });
    clearStatus();
    await signedIn(me);
  } else if (authMode === 'forgot') {
    await api('POST', '/api/auth/password/forgot', { email });
    setAuthMode('signin');
    showStatus('resetSent');
  } else if (authMode === 'reset') {
    const { user: me } = await api('POST', '/api/auth/password/reset', { token: resetToken, password });
    await signedIn(me);
    showStatus('passwordChanged');
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

els.clearCompleted.addEventListener('click', () => run(clearCompletedTodos));

els.themeToggle.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  save(STORAGE_KEYS.theme, theme);
  applyTheme();
});

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

els.authSwitch.addEventListener('click', () => {
  clearStatus();
  setAuthMode(AUTH_TEXT[authMode].switchTo);
});

els.authForgot.addEventListener('click', () => {
  clearStatus();
  setAuthMode('forgot');
});

els.signOut.addEventListener('click', signOut);
els.resendVerification.addEventListener('click', resendVerification);

start();
