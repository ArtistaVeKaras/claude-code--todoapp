// Checks that every translation key the page and app.js use exists in every language.
// t() only falls back to English when a whole language is missing, so one missing key
// would show "undefined" on screen.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const context = {};
vm.runInNewContext(`${read('i18n.js')}; this.TRANSLATIONS = TRANSLATIONS;`, context);
const { TRANSLATIONS } = context;
const languages = Object.keys(TRANSLATIONS);
const englishKeys = Object.keys(TRANSLATIONS.en);

test('every language has exactly the English keys, all non-empty', () => {
  assert.deepEqual(languages, ['en', 'fr', 'pt', 'es', 'pl']);
  for (const lang of languages) {
    assert.deepEqual(Object.keys(TRANSLATIONS[lang]).sort(), [...englishKeys].sort(), lang);
    for (const [key, value] of Object.entries(TRANSLATIONS[lang])) {
      if (typeof value === 'function') assert.equal(typeof value(2), 'string', `${lang}.${key}`);
      else assert.ok(typeof value === 'string' && value.trim(), `${lang}.${key}`);
    }
  }
});

test('every data-i18n key in index.html is translated', () => {
  const html = read('index.html');
  const keys = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 15, `found ${keys.length} keys`);
  for (const key of keys) assert.ok(englishKeys.includes(key), key);
});

test('every key app.js looks up is translated', () => {
  const js = read('app.js');
  const keys = new Set([
    ...[...js.matchAll(/\bt\('([A-Za-z]+)'\)/g)].map((m) => m[1]),
    ...[...js.matchAll(/showStatus\('([A-Za-z]+)'/g)].map((m) => m[1]),
    ...[...js.matchAll(/:\s*'(err[A-Za-z]+|sessionExpired)'/g)].map((m) => m[1]),
    ...[...js.matchAll(/(?:heading|submit|switchLabel): '([A-Za-z]+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(keys.size > 20, `found ${keys.size} keys`);
  for (const key of keys) assert.ok(englishKeys.includes(key), key);
});

test('every language has a matching option in the language picker', () => {
  const html = read('index.html');
  const options = [...html.matchAll(/<option value="([a-z]+)">/g)].map((m) => m[1]);
  assert.deepEqual(options, languages);
});

test('Polish item counts use the right plural forms', () => {
  const left = TRANSLATIONS.pl.itemsLeft;
  assert.equal(left(1), '1 zadanie do zrobienia');
  assert.equal(left(3), '3 zadania do zrobienia');
  assert.equal(left(5), '5 zadań do zrobienia');
  assert.equal(left(12), '12 zadań do zrobienia');
  assert.equal(left(22), '22 zadania do zrobienia');
});
