// Integration tests for the todos API (every query scoped to the signed-in user)
// and for the request-level protections: CSRF checks, body limits, static files and headers.

const test = require('node:test');
const assert = require('node:assert/strict');

const { startApp, signedIn } = require('./helpers');

let env;
test.beforeEach(async () => {
  env = await startApp();
});
test.afterEach(async () => {
  await env.close();
});

// ---------- todos ----------

test('todos: add, list in order, toggle, delete, clear completed', async () => {
  const client = await signedIn(env);
  assert.deepEqual((await client.get('/api/todos')).json, { todos: [] });

  const milk = (await client.post('/api/todos', { text: '  Buy milk  ' })).json.todo;
  assert.equal(milk.text, 'Buy milk', 'text is trimmed');
  assert.equal(milk.done, false);
  const eggs = (await client.post('/api/todos', { text: 'Buy eggs' })).json.todo;
  const bread = (await client.post('/api/todos', { text: 'Buy bread' })).json.todo;

  assert.deepEqual(
    (await client.get('/api/todos')).json.todos.map((t) => t.text),
    ['Buy milk', 'Buy eggs', 'Buy bread']
  );

  const toggled = await client.patch(`/api/todos/${milk.id}`, { done: true });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.json.todo.done, true);
  assert.equal((await client.patch(`/api/todos/${milk.id}`, { done: false })).json.todo.done, false);
  await client.patch(`/api/todos/${milk.id}`, { done: true });
  await client.patch(`/api/todos/${bread.id}`, { done: true });

  assert.equal((await client.del(`/api/todos/${eggs.id}`)).status, 204);
  assert.equal((await client.del(`/api/todos/${eggs.id}`)).status, 404, 'already gone');

  const cleared = await client.post('/api/todos/clear-completed');
  assert.deepEqual(cleared.json, { removed: 2 });
  assert.deepEqual((await client.get('/api/todos')).json, { todos: [] });
});

test('todos: new items go to the end even after earlier ones are deleted', async () => {
  const client = await signedIn(env);
  const a = (await client.post('/api/todos', { text: 'a' })).json.todo;
  await client.post('/api/todos', { text: 'b' });
  await client.del(`/api/todos/${a.id}`);
  await client.post('/api/todos', { text: 'c' });
  assert.deepEqual((await client.get('/api/todos')).json.todos.map((t) => t.text), ['b', 'c']);
});

test('todos: text must be 1-200 characters; done must be a boolean', async () => {
  const client = await signedIn(env);
  for (const text of [undefined, '', '   ', 42, null]) {
    assert.equal((await client.post('/api/todos', { text })).json.error, 'text_required', JSON.stringify(text));
  }
  assert.equal((await client.post('/api/todos', { text: 'x'.repeat(201) })).json.error, 'text_too_long');
  assert.equal((await client.post('/api/todos', { text: 'x'.repeat(200) })).status, 201);
  assert.equal((await client.post('/api/todos', { text: '😀'.repeat(200) })).status, 201, 'counted in characters');

  const todo = (await client.post('/api/todos', { text: 'ok' })).json.todo;
  for (const done of [undefined, 'true', 1, null]) {
    assert.equal((await client.patch(`/api/todos/${todo.id}`, { done })).json.error, 'done_required');
  }
});

test('todos: stored text is returned exactly, HTML and all (the page renders it as text)', async () => {
  const client = await signedIn(env);
  const text = '<img src=x onerror=alert(1)> & "quotes"';
  await client.post('/api/todos', { text });
  assert.equal((await client.get('/api/todos')).json.todos[0].text, text);
});

test('todos: users never see or change each other\'s todos', async () => {
  const ana = await signedIn(env, 'ana@example.com');
  const ben = await signedIn(env, 'ben@example.com');
  const anaTodo = (await ana.post('/api/todos', { text: "Ana's private task" })).json.todo;
  await ana.patch(`/api/todos/${anaTodo.id}`, { done: true });
  await ben.post('/api/todos', { text: "Ben's task" });

  assert.deepEqual((await ben.get('/api/todos')).json.todos.map((t) => t.text), ["Ben's task"]);
  assert.equal((await ben.patch(`/api/todos/${anaTodo.id}`, { done: false })).status, 404);
  assert.equal((await ben.del(`/api/todos/${anaTodo.id}`)).status, 404);
  assert.deepEqual((await ben.post('/api/todos/clear-completed')).json, { removed: 0 });

  const anaTodos = (await ana.get('/api/todos')).json.todos;
  assert.deepEqual(anaTodos, [{ id: anaTodo.id, text: "Ana's private task", done: true }]);
});

test('todos: every todo route needs a session', async () => {
  const client = await signedIn(env);
  const todo = (await client.post('/api/todos', { text: 'mine' })).json.todo;
  const anon = env.client();
  assert.equal((await anon.get('/api/todos')).status, 401);
  assert.equal((await anon.post('/api/todos', { text: 'x' })).status, 401);
  assert.equal((await anon.patch(`/api/todos/${todo.id}`, { done: true })).status, 401);
  assert.equal((await anon.del(`/api/todos/${todo.id}`)).status, 401);
  assert.equal((await anon.post('/api/todos/clear-completed')).status, 401);
  await client.post('/api/auth/logout');
  assert.equal((await client.get('/api/todos')).status, 401, 'and stops working after logout');
});

test('todos: odd ids and unknown routes give 404', async () => {
  const client = await signedIn(env);
  for (const id of ['nope', '../users', "1' OR '1'='1", 'a'.repeat(65)]) {
    const res = await client.patch(`/api/todos/${encodeURIComponent(id)}`, { done: true });
    assert.equal(res.status, 404, id);
  }
  assert.equal((await client.get('/api/nothing-here')).status, 404);
  assert.equal((await client.request('PUT', '/api/todos', { body: {} })).status, 404);
});

// ---------- CSRF and request checks ----------

test('CSRF: state-changing requests must be JSON', async () => {
  const client = await signedIn(env);
  const formPost = await client.request('POST', '/api/todos', {
    raw: 'text=hacked',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(formPost.status, 415);
  const textPlain = await client.request('POST', '/api/auth/logout-all', { raw: '{}', headers: { 'content-type': 'text/plain' } });
  assert.equal(textPlain.status, 415);
  const noType = await client.request('POST', '/api/todos', { raw: '{"text":"x"}' });
  assert.equal(noType.status, 415);
  assert.deepEqual((await client.get('/api/todos')).json.todos, []);
  assert.equal((await client.get('/api/auth/me')).status, 200, 'session untouched');
});

test('CSRF: requests from another origin are refused', async () => {
  const client = await signedIn(env);
  const evil = await client.post('/api/todos', { text: 'x' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.json.error, 'bad_origin');
  const crossSite = await client.post('/api/todos', { text: 'x' }, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(crossSite.status, 403);
  // Login from another site is refused too (login CSRF).
  const login = await env.client().post('/api/auth/login', { email: 'ana@example.com', password: 'correct horse battery' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(login.status, 403);

  assert.equal((await client.post('/api/todos', { text: 'x' }, { headers: { origin: 'http://localhost:3000' } })).status, 201, 'configured app origin');
  assert.equal((await client.post('/api/todos', { text: 'y' }, { headers: { origin: env.base, 'sec-fetch-site': 'same-origin' } })).status, 201, 'same host');
});

test('bad JSON, non-object JSON and oversized bodies are rejected', async () => {
  const client = await signedIn(env);
  assert.equal((await client.request('POST', '/api/todos', { raw: '{oops', headers: { 'content-type': 'application/json' } })).json.error, 'invalid_json');
  assert.equal((await client.request('POST', '/api/todos', { raw: '["a"]', headers: { 'content-type': 'application/json' } })).json.error, 'invalid_json');
  assert.equal((await client.request('POST', '/api/todos', { raw: 'null', headers: { 'content-type': 'application/json' } })).json.error, 'invalid_json');
  const huge = await client.request('POST', '/api/todos', {
    raw: JSON.stringify({ text: 'x'.repeat(20000) }),
    headers: { 'content-type': 'application/json; charset=utf-8' },
  }).catch((err) => ({ status: 'connection closed', err }));
  assert.ok(huge.status === 413 || huge.status === 'connection closed', `got ${huge.status}`);
  assert.equal((await client.get('/api/auth/me')).status, 200, 'server still fine');
});

test('API responses are never cached', async () => {
  const client = await signedIn(env);
  assert.equal((await client.get('/api/auth/me')).headers.get('cache-control'), 'no-store');
  assert.equal((await env.client().get('/api/todos')).headers.get('cache-control'), 'no-store');
});

// ---------- static files and headers ----------

test('static: serves the four app files with the right types', async () => {
  const client = env.client();
  const expected = {
    '/': 'text/html',
    '/index.html': 'text/html',
    '/app.js': 'text/javascript',
    '/i18n.js': 'text/javascript',
    '/styles.css': 'text/css',
  };
  for (const [url, type] of Object.entries(expected)) {
    const res = await client.get(url);
    assert.equal(res.status, 200, url);
    assert.ok(res.headers.get('content-type').startsWith(type), url);
  }
  assert.match((await client.get('/?reset=abc')).text, /<html/, 'query strings still serve the page');
});

test('static: nothing else in the repo is reachable', async () => {
  const client = env.client();
  for (const url of ['/server/app.js', '/package.json', '/.git/config', '/data/todo.db', '/../server/app.js', '/%2e%2e/package.json', '/tests/helpers.js', '/README.md']) {
    assert.equal((await client.get(url)).status, 404, url);
  }
  assert.equal((await client.request('POST', '/index.html', { body: {} })).status, 404);
});

test('security headers: CSP allows only our scripts plus the inline theme script by hash', async () => {
  const res = await env.client().get('/');
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]{44}'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!csp.includes('unsafe-inline'));

  // The hash matches the inline script actually in index.html.
  const crypto = require('node:crypto');
  const inline = /<script>([\s\S]*?)<\/script>/.exec(res.text)[1];
  const hash = crypto.createHash('sha256').update(inline).digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`));

  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('strict-transport-security'), null, 'no HSTS over plain HTTP');
});

test('production mode: __Host- cookie with Secure, and HSTS', async () => {
  await env.close();
  env = await startApp({ appOptions: { secureCookies: true } });
  const client = env.client();
  await client.post('/api/auth/signup', { email: 'ana@example.com', password: 'correct horse battery' });
  const res = await client.post('/api/auth/login', { email: 'ana@example.com', password: 'correct horse battery', remember: true });
  assert.match(res.headers.get('set-cookie'), /^__Host-session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=7776000$/);
  assert.match(res.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.equal((await client.get('/api/auth/me')).status, 200);
  // A plain "session" cookie is not accepted in this mode.
  const token = client.jar.get('__Host-session');
  const other = env.client();
  other.jar.set('session', token);
  assert.equal((await other.get('/api/auth/me')).status, 401);
});
