// Tests for createdAt, clearing all or completed tasks, the undo trash and restore, and the per-user todo limits.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { startApp, signedIn } = require('./helpers');
const { openDatabase } = require('../server/db');
const { UNDO_WINDOW, TODO_MAX_PER_USER } = require('../server/app');

const MINUTE = 60 * 1000;

let env;
test.beforeEach(async () => {
  env = await startApp();
});
test.afterEach(async () => {
  await env.close();
});

const texts = async (client) => (await client.get('/api/todos')).json.todos.map((t) => t.text);
const userId = async (client) => (await client.get('/api/auth/me')).json.user.id;

async function add(client, ...names) {
  const out = [];
  for (const text of names) out.push((await client.post('/api/todos', { text })).json.todo);
  return out;
}

// ---------- createdAt ----------

test('createdAt: in GET, POST and PATCH replies, and PATCH does not change it', async () => {
  const client = await signedIn(env);
  const created = env.clock.t;
  const posted = await client.post('/api/todos', { text: 'first' });
  assert.equal(posted.json.todo.createdAt, created);

  env.advance(5 * MINUTE);
  const patched = await client.patch(`/api/todos/${posted.json.todo.id}`, { text: 'renamed', done: true });
  assert.equal(patched.json.todo.createdAt, created);
  assert.equal((await client.get('/api/todos')).json.todos[0].createdAt, created);
  assert.equal(typeof created, 'number');
});

// ---------- DELETE /api/todos ----------

test('clear all: needs confirm, a session, JSON and a same-site request', async () => {
  const client = await signedIn(env);
  await add(client, 'a', 'b');

  for (const body of [{}, { confirm: true }, { confirm: 'yes' }, { confirm: 'ALL' }]) {
    const res = await client.del('/api/todos', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.json.error, 'confirm_required');
  }
  assert.equal((await env.client().del('/api/todos', { confirm: 'all' })).status, 401);
  const form = await client.request('DELETE', '/api/todos', { raw: 'confirm=all', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 415);
  const cross = await client.del('/api/todos', { confirm: 'all' }, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(cross.status, 403);
  assert.deepEqual(await texts(client), ['a', 'b'], 'nothing was removed by the refused calls');
});

test('clear all: removes only your tasks and returns the count and an undo token', async () => {
  const ana = await signedIn(env, 'ana@example.com');
  const ben = await signedIn(env, 'ben@example.com');
  await add(ana, 'a1', 'a2', 'a3');
  await add(ben, 'b1');

  const res = await ana.del('/api/todos', { confirm: 'all' });
  assert.equal(res.status, 200);
  assert.equal(res.json.removed, 3);
  assert.equal(typeof res.json.undo, 'string');
  assert.deepEqual(await texts(ana), []);
  assert.deepEqual(await texts(ben), ['b1']);

  const empty = await ana.del('/api/todos', { confirm: 'all' });
  assert.deepEqual(empty.json, { removed: 0, undo: null });
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM deleted_todos').get().n, 3, 'no batch for an empty clear');
});

// ---------- restore ----------

test('restore: brings tasks back in order with their ids, done and createdAt; a second restore is 404', async () => {
  const client = await signedIn(env);
  const [a, b, c] = await add(client, 'a', 'b', 'c');
  env.advance(MINUTE);
  await client.patch(`/api/todos/${b.id}`, { done: true });
  const cleared = await client.del('/api/todos', { confirm: 'all' });

  const restored = await client.post('/api/todos/restore', { undo: cleared.json.undo });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.json.todos, [
    { id: a.id, text: 'a', done: false, createdAt: a.createdAt },
    { id: b.id, text: 'b', done: true, createdAt: b.createdAt },
    { id: c.id, text: 'c', done: false, createdAt: c.createdAt },
  ]);
  assert.deepEqual((await client.get('/api/todos')).json.todos, restored.json.todos);

  const again = await client.post('/api/todos/restore', { undo: cleared.json.undo });
  assert.equal(again.status, 404);
  assert.equal(again.json.error, 'undo_expired');
});

const positionsOf = async (client) =>
  env.db.prepare('SELECT position FROM todos WHERE user_id = ?').all(await userId(client)).map((r) => r.position);

test('restore: tasks return to their original places; tasks added since the clear come after them', async () => {
  const client = await signedIn(env);
  await add(client, 'a', 'b', 'c');
  const cleared = await client.del('/api/todos', { confirm: 'all' });
  await add(client, 'x', 'y');
  await client.post('/api/todos/restore', { undo: cleared.json.undo });
  await add(client, 'z');
  assert.deepEqual(await texts(client), ['a', 'b', 'c', 'x', 'y', 'z']);

  const positions = await positionsOf(client);
  assert.equal(new Set(positions).size, positions.length, 'no duplicate positions');
});

test('restore: clear completed then undo puts A, B, C, D back in the original order', async () => {
  const client = await signedIn(env);
  const [, b, , d] = await add(client, 'A', 'B', 'C', 'D');
  await client.patch(`/api/todos/${b.id}`, { done: true });
  await client.patch(`/api/todos/${d.id}`, { done: true });
  const cleared = await client.post('/api/todos/clear-completed');
  assert.deepEqual(await texts(client), ['A', 'C']);

  const restored = await client.post('/api/todos/restore', { undo: cleared.json.undo });
  assert.deepEqual(restored.json.todos.map((t) => t.text), ['A', 'B', 'C', 'D']);
});

test('restore: clear all, add E, undo gives A to D in order and E last', async () => {
  const client = await signedIn(env);
  await add(client, 'A', 'B', 'C', 'D');
  const cleared = await client.del('/api/todos', { confirm: 'all' });
  await add(client, 'E');
  const restored = await client.post('/api/todos/restore', { undo: cleared.json.undo });
  assert.deepEqual(restored.json.todos.map((t) => t.text), ['A', 'B', 'C', 'D', 'E']);
});

test('restore: clearing the tail, adding a task and undoing leaves no duplicate positions', async () => {
  const client = await signedIn(env);
  const [, , c, d] = await add(client, 'A', 'B', 'C', 'D');
  await client.patch(`/api/todos/${c.id}`, { done: true });
  await client.patch(`/api/todos/${d.id}`, { done: true });
  const cleared = await client.post('/api/todos/clear-completed');
  await add(client, 'E');
  const restored = await client.post('/api/todos/restore', { undo: cleared.json.undo });
  assert.deepEqual(restored.json.todos.map((t) => t.text), ['A', 'B', 'C', 'D', 'E']);

  const positions = await positionsOf(client);
  assert.equal(new Set(positions).size, positions.length, 'no duplicate positions');
});

test('restore: another user\'s token, a wrong token and bad input', async () => {
  const ana = await signedIn(env, 'ana@example.com');
  const ben = await signedIn(env, 'ben@example.com');
  await add(ana, 'a');
  const cleared = await ana.del('/api/todos', { confirm: 'all' });

  const stolen = await ben.post('/api/todos/restore', { undo: cleared.json.undo });
  const wrong = await ben.post('/api/todos/restore', { undo: 'does-not-exist' });
  assert.equal(stolen.status, 404);
  assert.deepEqual(stolen.json, { error: 'undo_expired' });
  assert.deepEqual(wrong.json, stolen.json, 'same answer for wrong and foreign tokens');
  assert.deepEqual(await texts(ben), []);

  for (const undo of [undefined, '', 42, null, 'x'.repeat(65)]) {
    const res = await ana.post('/api/todos/restore', { undo });
    assert.equal(res.status, 400, JSON.stringify(undo));
    assert.equal(res.json.error, 'undo_required');
  }
  assert.equal((await env.client().post('/api/todos/restore', { undo: cleared.json.undo })).status, 401);
  assert.equal((await ana.post('/api/todos/restore', { undo: cleared.json.undo }, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await ana.post('/api/todos/restore', { undo: cleared.json.undo })).status, 200, 'owner can still restore');
});

test('restore: refused after the undo window', async () => {
  const client = await signedIn(env);
  await add(client, 'a');
  const cleared = await client.del('/api/todos', { confirm: 'all' });
  env.advance(UNDO_WINDOW - 1);
  const late = await client.post('/api/todos/restore', { undo: cleared.json.undo });
  assert.equal(late.status, 200, 'still inside the window');

  const second = await client.del('/api/todos', { confirm: 'all' });
  env.advance(UNDO_WINDOW);
  const expired = await client.post('/api/todos/restore', { undo: second.json.undo });
  assert.equal(expired.status, 404);
  assert.equal(expired.json.error, 'undo_expired');
  assert.deepEqual(await texts(client), []);
});

test('restore: over the per-user cap gives too_many_todos and restores nothing', async () => {
  const client = await signedIn(env);
  const id = await userId(client);
  await add(client, 'a', 'b', 'c');
  const cleared = await client.del('/api/todos', { confirm: 'all' });

  const insert = env.db.prepare('INSERT INTO todos (id, user_id, text, done, created_at, position) VALUES (?, ?, ?, 0, ?, ?)');
  env.db.exec('BEGIN');
  for (let i = 0; i < TODO_MAX_PER_USER - 2; i++) insert.run(`filler-${i}`, id, 'filler', env.clock.t, i + 1);
  env.db.exec('COMMIT');

  const res = await client.post('/api/todos/restore', { undo: cleared.json.undo });
  assert.equal(res.status, 400);
  assert.equal(res.json.error, 'too_many_todos');
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM todos WHERE user_id = ?').get(id).n, TODO_MAX_PER_USER - 2);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM deleted_todos WHERE user_id = ?').get(id).n, 3, 'trash kept');
});

// ---------- clear completed ----------

test('clear completed: returns an undo token that restores only those tasks', async () => {
  const client = await signedIn(env);
  const [a, b, c] = await add(client, 'a', 'b', 'c');
  await client.patch(`/api/todos/${a.id}`, { done: true });
  await client.patch(`/api/todos/${c.id}`, { done: true });

  const cleared = await client.post('/api/todos/clear-completed');
  assert.equal(cleared.json.removed, 2);
  assert.deepEqual(await texts(client), ['b']);

  const restored = await client.post('/api/todos/restore', { undo: cleared.json.undo });
  assert.deepEqual(restored.json.todos.map((t) => t.text), ['a', 'b', 'c']);
  assert.deepEqual(restored.json.todos.map((t) => t.done), [true, false, true]);
  assert.equal(restored.json.todos[1].id, b.id);

  await client.del('/api/todos', { confirm: 'all' });
  assert.deepEqual((await client.post('/api/todos/clear-completed')).json, { removed: 0, undo: null });
});

// ---------- rate limits ----------

test('rate limit: the 21st bulk call is 429 with retryAfter, and anonymous calls are not counted', async () => {
  const client = await signedIn(env);
  for (let i = 0; i < 30; i++) assert.equal((await env.client().del('/api/todos', { confirm: 'all' })).status, 401);
  for (let i = 0; i < 20; i++) assert.equal((await client.del('/api/todos', { confirm: 'all' })).status, 200, `call ${i + 1}`);
  const blocked = await client.del('/api/todos', { confirm: 'all' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, 'too_many_requests');
  assert.ok(blocked.json.retryAfter === undefined || blocked.json.retryAfter > 0);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.equal((await client.post('/api/todos/clear-completed')).status, 429, 'clear completed shares the clear limit');

  env.advance(10 * MINUTE);
  assert.equal((await client.del('/api/todos', { confirm: 'all' })).status, 200);
});

test('rate limit: restore has its own limit, separate from clearing', async () => {
  const client = await signedIn(env);
  await add(client, 'a');
  const first = await client.del('/api/todos', { confirm: 'all' });
  for (let i = 0; i < 19; i++) await client.del('/api/todos', { confirm: 'all' });
  assert.equal((await client.del('/api/todos', { confirm: 'all' })).status, 429, 'clear limit is used up');

  const restored = await client.post('/api/todos/restore', { undo: first.json.undo });
  assert.equal(restored.status, 200, 'restore still works');
  assert.deepEqual(await texts(client), ['a']);

  for (let i = 1; i < 20; i++) assert.equal((await client.post('/api/todos/restore', { undo: 'x' })).status, 404, `restore ${i + 1}`);
  const blocked = await client.post('/api/todos/restore', { undo: 'x' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('expired trash of the user is removed on their next clear or restore; other users are untouched', async () => {
  const ana = await signedIn(env, 'ana@example.com');
  const ben = await signedIn(env, 'ben@example.com');
  const anaId = await userId(ana);
  const benId = await userId(ben);
  const count = (id) => env.db.prepare('SELECT COUNT(*) AS n FROM deleted_todos WHERE user_id = ?').get(id).n;

  await add(ana, 'a1', 'a2');
  await add(ben, 'b1');
  await ana.del('/api/todos', { confirm: 'all' });
  await ben.del('/api/todos', { confirm: 'all' });
  env.advance(UNDO_WINDOW);
  assert.equal(count(anaId), 2);

  // Clear: the empty clear stores nothing, yet the expired rows still go.
  await ana.del('/api/todos', { confirm: 'all' });
  assert.equal(count(anaId), 0, 'cleared on next clear');
  assert.equal(count(benId), 1, 'other user untouched');

  // Restore: a refused restore also purges.
  await add(ana, 'a3');
  await ana.del('/api/todos', { confirm: 'all' });
  env.advance(UNDO_WINDOW);
  assert.equal(count(anaId), 1);
  assert.equal((await ana.post('/api/todos/restore', { undo: 'nope' })).status, 404);
  assert.equal(count(anaId), 0, 'cleared on next restore');
  assert.equal(count(benId), 1, 'other user untouched');
});

// The startup purge is a single call in server/server.js, which starts a real server on require, so it is not tested here.

test('rate limit: single-task writes are limited per user', async () => {
  const ana = await signedIn(env, 'ana@example.com');
  const ben = await signedIn(env, 'ben@example.com');
  for (let i = 0; i < 120; i++) assert.equal((await ana.post('/api/todos', { text: `t${i}` })).status, 201, `write ${i + 1}`);
  const blocked = await ana.post('/api/todos', { text: 'one too many' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  const id = (await ana.get('/api/todos')).json.todos[0].id;
  assert.equal((await ana.patch(`/api/todos/${id}`, { done: true })).status, 429);
  assert.equal((await ana.del(`/api/todos/${id}`)).status, 429);
  assert.equal((await ben.post('/api/todos', { text: 'fine' })).status, 201, 'other users are not affected');

  env.advance(MINUTE);
  assert.equal((await ana.post('/api/todos', { text: 'again' })).status, 201);
});

// ---------- purge and account deletion ----------

test('purge: trash is removed only once the undo window has passed', async () => {
  const client = await signedIn(env);
  await add(client, 'a', 'b');
  await client.del('/api/todos', { confirm: 'all' });

  env.advance(UNDO_WINDOW - 1);
  assert.equal(env.app.purgeExpired().todos, 0);
  env.advance(1);
  assert.equal(env.app.purgeExpired().todos, 2);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM deleted_todos').get().n, 0);
});

test('deleting the account removes its trash', async () => {
  const client = await signedIn(env);
  await add(client, 'a', 'b');
  await client.del('/api/todos', { confirm: 'all' });
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM deleted_todos').get().n, 2);
  const res = await client.del('/api/auth/account', { password: 'correct horse battery' });
  assert.equal(res.status, 204);
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM deleted_todos').get().n, 0);
});

// ---------- schema upgrade ----------

test('openDatabase adds deleted_todos to an existing database without losing todos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-db-'));
  const file = path.join(dir, 'old.db');
  try {
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, email_verified_at INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE todos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, position INTEGER NOT NULL);
      INSERT INTO users VALUES ('u1', 'a@example.com', NULL, 1);
      INSERT INTO todos VALUES ('t1', 'u1', 'keep me', 0, 5, 1);
    `);
    old.close();

    const db = openDatabase(file);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    assert.ok(tables.includes('deleted_todos'));
    assert.deepEqual({ ...db.prepare('SELECT id, text, created_at FROM todos').get() }, { id: 't1', text: 'keep me', created_at: 5 });
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
