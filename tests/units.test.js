// Unit tests for the building blocks: password hashing and policy, secrets,
// the rate limiter and the cookie helpers.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createHasher, checkPasswordPolicy, DEFAULT_PARAMS } = require('../server/passwords');
const { newSecret, hashSecret } = require('../server/tokens');
const { createRateLimiter } = require('../server/rate-limit');
const { parseCookies, serializeCookie } = require('../server/http');
const { FAST_HASH } = require('./helpers');

test('passwords: hash verifies the right password and rejects others', async () => {
  const hasher = createHasher(FAST_HASH);
  const stored = await hasher.hash('correct horse battery');
  assert.match(stored, /^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await hasher.verify('correct horse battery', stored), true);
  assert.equal(await hasher.verify('correct horse batterY', stored), false);
  assert.equal(await hasher.verify('', stored), false);
});

test('passwords: the same password gets a different salt every time', async () => {
  const hasher = createHasher(FAST_HASH);
  const a = await hasher.hash('same password');
  const b = await hasher.hash('same password');
  assert.notEqual(a, b);
});

test('passwords: malformed stored hashes never verify', async () => {
  const hasher = createHasher(FAST_HASH);
  for (const stored of ['', 'plain', 'bcrypt$1$2$3$4$5', 'scrypt$1024$8$1$abc', null, undefined]) {
    assert.equal(await hasher.verify('anything', stored), false);
  }
});

test('passwords: unicode is normalized, so composed and decomposed forms match', async () => {
  const hasher = createHasher(FAST_HASH);
  const stored = await hasher.hash('café au lait');
  assert.equal(await hasher.verify('café au lait', stored), true);
});

test('passwords: needsRehash flags hashes made with other parameters', async () => {
  const fast = createHasher(FAST_HASH);
  const strong = createHasher({ N: 2 ** 11, r: 8, p: 1 });
  const stored = await fast.hash('password one');
  assert.equal(fast.needsRehash(stored), false);
  assert.equal(strong.needsRehash(stored), true);
  // A hash made with old parameters still verifies under the new hasher.
  assert.equal(await strong.verify('password one', stored), true);
});

test('passwords: production parameters are the OWASP scrypt setting', () => {
  assert.deepEqual(DEFAULT_PARAMS, { N: 2 ** 17, r: 8, p: 1 });
});

test('passwords: production-strength hashing works within the memory limit', async () => {
  const hasher = createHasher();
  const stored = await hasher.hash('strong settings');
  assert.equal(await hasher.verify('strong settings', stored), true);
});

test('password policy: length only, 8 to 128 characters', () => {
  assert.equal(checkPasswordPolicy(undefined), 'password_required');
  assert.equal(checkPasswordPolicy(12345678), 'password_required');
  assert.equal(checkPasswordPolicy('1234567'), 'password_too_short');
  assert.equal(checkPasswordPolicy('12345678'), null);
  assert.equal(checkPasswordPolicy('a'.repeat(128)), null);
  assert.equal(checkPasswordPolicy('a'.repeat(129)), 'password_too_long');
  assert.equal(checkPasswordPolicy('alllowercase'), null, 'no composition rules');
  // Counted in characters, not UTF-16 units: 8 emoji is 8 characters.
  assert.equal(checkPasswordPolicy('😀'.repeat(8)), null);
  assert.equal(checkPasswordPolicy('😀'.repeat(7)), 'password_too_short');
});

test('secrets: 256-bit, url-safe, unique; hashes are SHA-256 hex', () => {
  const a = newSecret();
  const b = newSecret();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashSecret(a), /^[0-9a-f]{64}$/);
  assert.equal(hashSecret(a), hashSecret(a));
  assert.notEqual(hashSecret(a), hashSecret(b));
});

test('rate limiter: blocks after the limit and reopens when the window ends', () => {
  const clock = { t: 0 };
  const limiter = createRateLimiter({ now: () => clock.t });
  for (let i = 0; i < 3; i++) assert.equal(limiter.take('k', 3, 1000).ok, true);
  const blocked = limiter.take('k', 3, 1000);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterMs, 1000);
  clock.t = 999;
  assert.equal(limiter.take('k', 3, 1000).ok, false);
  clock.t = 1000;
  assert.equal(limiter.take('k', 3, 1000).ok, true);
});

test('rate limiter: keys are independent, reset clears one key, sweep drops old windows', () => {
  const clock = { t: 0 };
  const limiter = createRateLimiter({ now: () => clock.t });
  limiter.hit('a', 1000);
  limiter.hit('a', 1000);
  assert.equal(limiter.check('a', 2, 1000).ok, false);
  assert.equal(limiter.check('b', 2, 1000).ok, true);
  limiter.reset('a');
  assert.equal(limiter.check('a', 2, 1000).ok, true);
  limiter.hit('a', 1000);
  clock.t = 5000;
  limiter.sweep();
  assert.equal(limiter.check('a', 1, 1000).ok, true);
});

test('cookies: parse handles spaces, duplicates, = in values and bad encoding', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies('a=1; b=two; a=3'), { a: '1', b: 'two' });
  assert.deepEqual(parseCookies('x=a=b; junk; y=%E0%A4%A'), { x: 'a=b', y: '%E0%A4%A' });
  assert.deepEqual(parseCookies('n=hello%20world'), { n: 'hello world' });
});

test('cookies: serialize sets HttpOnly, SameSite=Lax, Path, and Secure/Max-Age when asked', () => {
  assert.equal(serializeCookie('session', 'abc', {}), 'session=abc; Path=/; HttpOnly; SameSite=Lax');
  assert.equal(
    serializeCookie('__Host-session', 'abc', { secure: true, maxAgeSeconds: 60 }),
    '__Host-session=abc; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60'
  );
});

// ---------- page code (app.js) ----------
// app.js touches the DOM as soon as it loads, so it cannot be required in Node. These tests copy the
// source of a few pure functions out of app.js and run them in a vm sandbox with a fixed clock. If a
// function is renamed or reshaped, extract() throws and the test fails loudly.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// Returns the source of the top-level function or const that starts at startPattern, up to its closing line.
function extract(startPattern) {
  const start = appSource.search(startPattern);
  assert.ok(start >= 0, `app.js has ${startPattern}`);
  const end = appSource.indexOf('\n}', start);
  const closer = appSource.slice(end, end + 3) === '\n};' ? 3 : 2;
  return appSource.slice(start, end + closer);
}

// Builds a sandbox with the real functions from app.js, a fixed clock and an in-memory localStorage.
function loadPage({ now, lang = 'en' }) {
  const translations = {};
  vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8')}; this.T = TRANSLATIONS;`, translations);
  const stored = {};
  const sandbox = {
    FixedNow: now,
    TRANSLATIONS: translations.T,
    storage: stored,
    localStorage: { setItem: (k, v) => { stored[k] = v; }, getItem: (k) => (k in stored ? stored[k] : null) },
  };
  const code = `
    class FakeDate extends Date {
      constructor(...args) { super(...(args.length ? args : [FixedNow])); }
      static now() { return FixedNow; }
    }
    Date = FakeDate;
    const STORAGE_KEYS = { todos: 'todo-items', theme: 'todo-theme', lang: 'todo-lang' };
    let lang = ${JSON.stringify(lang)};
    let mode = 'local';
    let todos = [];
    const hideUndo = () => {};
    const render = () => {};
    const announce = () => {};
    // A just-enough document for createTimeElement: elements are plain objects.
    const document = {
      createElement: (tag) => ({ tag, children: [], attrs: {},
        setAttribute(k, v) { this.attrs[k] = v; }, append(...kids) { this.children.push(...kids); } }),
    };
    function t(key) { return (TRANSLATIONS[lang] || TRANSLATIONS.en)[key]; }
    ${extract(/^function save\(/m)}
    ${extract(/^const ERROR_KEYS = /m)}
    ${extract(/^function intlLocale\(/m)}
    const formatters = {};
    ${extract(/^function formatter\(/m)}
    ${extract(/^function formatAddedAt\(/m)}
    ${extract(/^function createTimeElement\(/m)}
    ${extract(/^function backfillCreatedAt\(/m)}
    ${extract(/^async function addTodo\(/m)}
    this.api = { ERROR_KEYS, intlLocale, formatAddedAt, createTimeElement, backfillCreatedAt, addTodo,
      setLang: (l) => { lang = l; }, setRandom: (f) => { Math.random = f; }, todos: () => todos };
  `;
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

const NOW = new Date(2026, 5, 15, 14, 30, 0).getTime(); // 15 June 2026, 14:30 local time
const localId = (ms, suffix = 'abcd') => ms.toString(36) + suffix;

test('page: backfillCreatedAt recovers createdAt from a local id and saves', () => {
  const page = loadPage({ now: NOW });
  const made = new Date(2026, 5, 10, 9, 15).getTime();
  const list = [{ id: localId(made), text: 'a', done: false }, { id: localId(made + 1000, 'wxyz'), text: 'b', done: true }];
  page.api.backfillCreatedAt(list);
  assert.equal(list[0].createdAt, made);
  assert.equal(list[1].createdAt, made + 1000);
  assert.deepEqual(JSON.parse(page.storage['todo-items']).map((i) => i.createdAt), [made, made + 1000]);
});

test('page: backfillCreatedAt skips ids that cannot be parsed or are out of range', () => {
  const page = loadPage({ now: NOW });
  const list = [
    { id: 'zzzz', text: 'too short' },
    { id: 'not an id!', text: 'junk' },
    { id: '', text: 'empty' },
    { id: localId(Date.UTC(2019, 11, 31)), text: 'before 2020' },
    { id: localId(NOW + 2 * 86400000), text: 'more than a day ahead' },
    { id: 'a1b2c3d4-e5f6', text: 'uuid-like' },
  ];
  page.api.backfillCreatedAt(list);
  list.forEach((item) => assert.equal(item.createdAt, undefined, item.text));
  assert.equal('todo-items' in page.storage, false, 'nothing changed, so nothing is saved');
});

test('page: backfillCreatedAt accepts a time a little ahead and the 2020 boundary', () => {
  const page = loadPage({ now: NOW });
  const list = [{ id: localId(NOW + 3600000) }, { id: localId(Date.UTC(2020, 0, 1)) }];
  page.api.backfillCreatedAt(list);
  assert.equal(list[0].createdAt, NOW + 3600000);
  assert.equal(list[1].createdAt, Date.UTC(2020, 0, 1));
});

test('page: backfillCreatedAt leaves an existing numeric createdAt alone and does not save', () => {
  const page = loadPage({ now: NOW });
  const list = [{ id: localId(NOW - 5000), createdAt: 12345 }, { id: localId(NOW - 5000), createdAt: 0 }];
  page.api.backfillCreatedAt(list);
  assert.deepEqual(list.map((i) => i.createdAt), [12345, 0]);
  assert.equal('todo-items' in page.storage, false);
});

test('page: backfillCreatedAt replaces a createdAt that is not a number', () => {
  const page = loadPage({ now: NOW });
  const list = [{ id: localId(NOW - 5000), createdAt: '2026-01-01' }];
  page.api.backfillCreatedAt(list);
  assert.equal(list[0].createdAt, NOW - 5000);
});

test('page: backfillCreatedAt saves when only some tasks in a mixed list changed', () => {
  const page = loadPage({ now: NOW });
  const list = [{ id: 'zzzz' }, { id: localId(NOW - 60000) }, { id: localId(NOW), createdAt: NOW }];
  page.api.backfillCreatedAt(list);
  assert.equal(list[0].createdAt, undefined);
  assert.equal(list[1].createdAt, NOW - 60000);
  assert.ok(page.storage['todo-items']);
});

test('page: formatAddedAt says "now" for under a minute', () => {
  const page = loadPage({ now: NOW });
  const now = page.TRANSLATIONS.en.timeNow;
  assert.equal(page.api.formatAddedAt(NOW), now);
  assert.equal(page.api.formatAddedAt(NOW - 59999), now);
  assert.equal(page.api.formatAddedAt(NOW + 5000), now, 'a time slightly in the future');
  assert.notEqual(page.api.formatAddedAt(NOW - 60000), now);
});

test('page: formatAddedAt shows minutes under an hour', () => {
  const page = loadPage({ now: NOW });
  assert.match(page.api.formatAddedAt(NOW - 60000), /^1\s?min/);
  assert.match(page.api.formatAddedAt(NOW - 5 * 60000 - 30000), /^5\s?min/);
  assert.match(page.api.formatAddedAt(NOW - 59 * 60000), /^59\s?min/);
});

test('page: formatAddedAt shows only the time for earlier today', () => {
  const page = loadPage({ now: NOW });
  const text = page.api.formatAddedAt(new Date(2026, 5, 15, 9, 5).getTime());
  assert.match(text, /9[:.]05/);
  assert.doesNotMatch(text, /min|2026|Jun/);
  const hourAgo = page.api.formatAddedAt(NOW - 60 * 60000);
  assert.match(hourAgo, /1[:.]30|13[:.]30/);
  assert.doesNotMatch(hourAgo, /min/);
});

test('page: formatAddedAt shows day and month, without the year, for earlier this year', () => {
  const page = loadPage({ now: NOW });
  const text = page.api.formatAddedAt(new Date(2026, 2, 3, 9, 5).getTime());
  assert.match(text, /3/);
  assert.doesNotMatch(text, /2026|9[:.]05/);
  const yesterday = page.api.formatAddedAt(new Date(2026, 5, 14, 23, 50).getTime());
  assert.match(yesterday, /14/);
  assert.doesNotMatch(yesterday, /2026|min/);
});

test('page: formatAddedAt includes the year for an earlier year', () => {
  const page = loadPage({ now: NOW });
  const text = page.api.formatAddedAt(new Date(2025, 2, 3, 9, 5).getTime());
  assert.match(text, /2025/);
  assert.match(text, /3/);
  assert.match(page.api.formatAddedAt(new Date(2025, 11, 31, 23, 59).getTime()), /2025/);
});

test('page: formatAddedAt follows the page language for the text and the minute unit', () => {
  const page = loadPage({ now: NOW });
  for (const lang of ['en', 'fr', 'pt', 'es', 'pl']) {
    page.api.setLang(lang);
    assert.equal(page.api.formatAddedAt(NOW), page.TRANSLATIONS[lang].timeNow, lang);
    assert.match(page.api.formatAddedAt(NOW - 5 * 60000), /5/, lang);
    assert.match(page.api.formatAddedAt(new Date(2024, 0, 9).getTime()), /2024/, lang);
  }
});

test('page: intlLocale turns pt into pt-PT and leaves the other languages unchanged', () => {
  const page = loadPage({ now: NOW });
  const results = {};
  for (const lang of ['en', 'fr', 'pt', 'es', 'pl']) {
    page.api.setLang(lang);
    results[lang] = page.api.intlLocale();
  }
  assert.deepEqual(results, { en: 'en', fr: 'fr', pt: 'pt-PT', es: 'es', pl: 'pl' });
});

test('page: the local id suffix is always 4 characters, even when Math.random gives a short string', async () => {
  const page = loadPage({ now: NOW });
  const values = [0, 0.5, 0.0000001, 0.999999999, 0.25, 1 / 36];
  for (const value of values) {
    page.api.setRandom(() => value);
    await page.api.addTodo('x');
  }
  page.api.setRandom(() => 0.123456789);
  for (let i = 0; i < 20; i += 1) await page.api.addTodo('y');
  const todos = page.api.todos();
  assert.equal(todos.length, values.length + 20);
  for (const todo of todos) {
    assert.equal(todo.id.length, NOW.toString(36).length + 4, todo.id);
    assert.equal(todo.createdAt, NOW);
    assert.equal(parseInt(todo.id.slice(0, -4), 36), NOW, 'the time part can be read back');
  }
});

test('page: ids made by addTodo are recovered by backfillCreatedAt', async () => {
  const page = loadPage({ now: NOW });
  await page.api.addTodo('hello');
  const [todo] = page.api.todos();
  delete todo.createdAt;
  page.api.backfillCreatedAt([todo]);
  assert.equal(todo.createdAt, NOW);
});

test('page: ERROR_KEYS maps the undo and clear-all errors to keys that exist in every language', () => {
  const page = loadPage({ now: NOW });
  const expected = {
    undo_expired: 'errUndoExpired',
    too_many_todos: 'errTooManyTodos',
    confirm_required: 'errConfirmRequired',
    undo_required: 'errUndoRequired',
  };
  for (const [code, key] of Object.entries(expected)) assert.equal(page.api.ERROR_KEYS[code], key, code);
  for (const key of Object.values(page.api.ERROR_KEYS)) {
    for (const lang of Object.keys(page.TRANSLATIONS)) {
      const value = page.TRANSLATIONS[lang][key];
      assert.ok(typeof value === 'string' && value.trim(), `${lang}.${key}`);
    }
  }
});

test('page: createTimeElement returns null for a createdAt that cannot be shown', () => {
  const page = loadPage({ now: NOW });
  for (const createdAt of [1e20, -1e20, NaN, Infinity, '1700000000000', null, undefined]) {
    assert.equal(page.api.createTimeElement({ createdAt }, 0), null, String(createdAt));
  }
});

test('page: createTimeElement gives a short visible label and an absolute hidden one', () => {
  const page = loadPage({ now: NOW });
  const time = page.api.createTimeElement({ createdAt: NOW - 5 * 60000 }, 3);
  assert.equal(time.id, 'todo-time-3');
  assert.equal(time.dateTime, new Date(NOW - 5 * 60000).toISOString());
  const [short, hidden] = time.children;
  assert.equal(short.className, 'todo-time-short');
  assert.equal(short.attrs['aria-hidden'], 'true');
  assert.match(short.textContent, /^5\s?min/);
  assert.equal(hidden.className, 'visually-hidden');
  assert.match(hidden.textContent, /^Added /);
  assert.equal(short.title, hidden.textContent);
});
