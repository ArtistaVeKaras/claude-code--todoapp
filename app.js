// Simple TODO app: tasks, theme and language are saved in localStorage.

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
};

let todos = load(STORAGE_KEYS.todos, []);
let filter = 'all';
let lang = load(STORAGE_KEYS.lang, null) || detectLanguage();
let theme = load(STORAGE_KEYS.theme, null) || detectTheme();

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

// ---------- todos ----------

function addTodo(text) {
  todos.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false });
  save(STORAGE_KEYS.todos, todos);
  render();
}

function toggleTodo(id) {
  const todo = todos.find((item) => item.id === id);
  if (todo) todo.done = !todo.done;
  save(STORAGE_KEYS.todos, todos);
  render();
}

function deleteTodo(id) {
  todos = todos.filter((item) => item.id !== id);
  save(STORAGE_KEYS.todos, todos);
  render();
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
    checkbox.addEventListener('change', () => toggleTodo(item.id));

    const span = document.createElement('span');
    span.className = 'todo-text';
    span.textContent = item.text;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-button';
    del.textContent = '✕';
    del.setAttribute('aria-label', t('delete'));
    del.title = t('delete');
    del.addEventListener('click', () => deleteTodo(item.id));

    li.append(checkbox, span, del);
    els.list.appendChild(li);
  });

  els.empty.hidden = visible.length > 0;
  els.itemsLeft.textContent = t('itemsLeft')(todos.filter((item) => !item.done).length);
  els.clearCompleted.hidden = !todos.some((item) => item.done);
  els.filters.forEach((btn) => btn.classList.toggle('active', btn.dataset.filter === filter));
}

// ---------- events ----------

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  addTodo(text);
  els.input.value = '';
  els.input.focus();
});

els.filters.forEach((btn) =>
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    render();
  })
);

els.clearCompleted.addEventListener('click', () => {
  todos = todos.filter((item) => !item.done);
  save(STORAGE_KEYS.todos, todos);
  render();
});

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

applyLanguage();
