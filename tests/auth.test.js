// Integration tests for the auth API: each test runs a real HTTP server
// with an in-memory database and a fake clock.

const test = require('node:test');
const assert = require('node:assert/strict');

const { startApp, signedIn } = require('./helpers');
const { SESSION } = require('../server/app');
const { hashSecret } = require('../server/tokens');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PASSWORD = 'correct horse battery';

let env;
test.beforeEach(async () => {
  env = await startApp();
});
test.afterEach(async () => {
  await env.close();
});

// ---------- signup ----------

test('signup creates an unverified account and emails a verification link', async () => {
  const client = env.client();
  const res = await client.post('/api/auth/signup', { email: '  Ana@Example.COM ', password: PASSWORD });
  assert.equal(res.status, 202);
  assert.deepEqual(res.json, { status: 'check_email' });
  assert.equal(client.jar.size, 0, 'signup itself does not sign in');

  const user = env.db.prepare('SELECT * FROM users').get();
  assert.equal(user.email, 'ana@example.com', 'email is trimmed and lower-cased');
  assert.equal(user.email_verified_at, null);

  const credential = env.db.prepare('SELECT password_hash FROM password_credentials').get();
  assert.match(credential.password_hash, /^scrypt\$/);
  assert.ok(!credential.password_hash.includes(PASSWORD), 'password is never stored');

  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].to, 'ana@example.com');
  assert.ok(env.lastLink('verify'));
});

test('signup rejects bad emails and passwords outside 8-128 characters', async () => {
  const client = env.client();
  for (const email of ['', 'no-at-sign', 'a@b', 'two@@example.com', 'sp ace@example.com', `${'a'.repeat(250)}@x.com`, 42]) {
    const res = await client.post('/api/auth/signup', { email, password: PASSWORD });
    assert.equal(res.status, 400, `email ${JSON.stringify(email)}`);
    assert.equal(res.json.error, 'invalid_email');
  }
  assert.equal((await client.post('/api/auth/signup', { email: 'a@example.com', password: 'short' })).json.error, 'password_too_short');
  assert.equal((await client.post('/api/auth/signup', { email: 'a@example.com', password: 'x'.repeat(129) })).json.error, 'password_too_long');
  assert.equal((await client.post('/api/auth/signup', { email: 'a@example.com' })).json.error, 'password_required');
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('signup with a taken email answers exactly like a new one and keeps the old password', async () => {
  const client = env.client();
  await client.post('/api/auth/signup', { email: 'ana@example.com', password: PASSWORD });
  const again = await client.post('/api/auth/signup', { email: 'ANA@example.com', password: 'attacker password' });
  assert.equal(again.status, 202);
  assert.deepEqual(again.json, { status: 'check_email' });
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  // The owner gets a heads-up instead of a second verification link.
  assert.match(env.sent.at(-1).subject, /tried to sign up/);
  assert.equal((await client.post('/api/auth/login', { email: 'ana@example.com', password: 'attacker password' })).status, 401);
  assert.equal((await client.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD })).status, 200);
});

// ---------- login and sessions ----------

test('login sets an HttpOnly session cookie and /me returns the user', async () => {
  const client = env.client();
  await client.post('/api/auth/signup', { email: 'ana@example.com', password: PASSWORD });
  const res = await client.post('/api/auth/login', { email: 'ANA@example.com', password: PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.email, 'ana@example.com');
  assert.equal(res.json.user.emailVerified, false);

  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax$/, 'no Max-Age without remember me');

  const me = await client.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.user, res.json.user);
});

test('the database stores only a hash of the session token', async () => {
  const client = await signedIn(env);
  const token = client.jar.get('session');
  const row = env.db.prepare('SELECT id_hash FROM sessions').get();
  assert.equal(row.id_hash, hashSecret(token));
  assert.notEqual(row.id_hash, token);
});

test('login fails with one generic error for a wrong password, unknown email or bad input', async () => {
  const client = env.client();
  await client.post('/api/auth/signup', { email: 'ana@example.com', password: PASSWORD });
  const attempts = [
    { email: 'ana@example.com', password: 'wrong password' },
    { email: 'nobody@example.com', password: PASSWORD },
    { email: 'ana@example.com', password: '' },
    { email: 'not-an-email', password: PASSWORD },
    { email: 'ana@example.com' },
  ];
  for (const body of attempts) {
    const res = await client.post('/api/auth/login', body);
    assert.equal(res.status, 401, JSON.stringify(body));
    assert.deepEqual(res.json, { error: 'invalid_credentials' });
    assert.equal(res.headers.get('set-cookie'), null);
  }
});

test('login for an unknown email still runs a password hash (no timing shortcut)', async () => {
  let verifies = 0;
  const { createHasher } = require('../server/passwords');
  const { FAST_HASH } = require('./helpers');
  const base = createHasher(FAST_HASH);
  const counting = { ...base, verify: async (...args) => (verifies++, base.verify(...args)) };
  await env.close();
  env = await startApp({ hasher: counting });
  await env.client().post('/api/auth/login', { email: 'nobody@example.com', password: PASSWORD });
  assert.equal(verifies, 1);
});

test('"remember me" gives a 90-day cookie; without it the session ends after 24h idle', async () => {
  const remembered = await signedIn(env, 'ana@example.com', PASSWORD, true);
  const res = await remembered.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD, remember: true });
  assert.match(res.headers.get('set-cookie'), /Max-Age=7776000/);

  const shortLived = env.client();
  await shortLived.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD });

  // Neither session is used for exactly 24 hours.
  env.advance(DAY);
  assert.equal((await shortLived.get('/api/auth/me')).status, 401, 'short session idles out at 24h');
  assert.equal((await remembered.get('/api/auth/me')).status, 200, 'remembered session survives');
});

test('activity extends a session, but never past the 90-day absolute limit', async () => {
  const client = await signedIn(env, 'ana@example.com', PASSWORD, true);
  // Use it every 20 days: each use pushes the 30-day idle expiry forward.
  for (let day = 20; day < 90; day += 20) {
    env.advance(20 * DAY);
    assert.equal((await client.get('/api/auth/me')).status, 200, `day ${day}`);
  }
  // Day 80 now. Day 90 is the hard stop even though the user was active.
  env.advance(10 * DAY);
  assert.equal((await client.get('/api/auth/me')).status, 401);
});

test('a short session used within 24h keeps going (sliding idle timeout)', async () => {
  const client = await signedIn(env);
  for (let i = 0; i < 5; i++) {
    env.advance(20 * HOUR);
    assert.equal((await client.get('/api/auth/me')).status, 200);
  }
  env.advance(DAY);
  assert.equal((await client.get('/api/auth/me')).status, 401);
});

test('last_seen_at is written at most once every 5 minutes', async () => {
  const client = await signedIn(env);
  const lastSeen = () => env.db.prepare('SELECT last_seen_at FROM sessions').get().last_seen_at;
  const start = lastSeen();
  env.advance(4 * MINUTE);
  await client.get('/api/auth/me');
  assert.equal(lastSeen(), start);
  env.advance(MINUTE);
  await client.get('/api/auth/me');
  assert.equal(lastSeen(), start + 5 * MINUTE);
});

test('each login issues a new session token (no session fixation)', async () => {
  const client = await signedIn(env);
  const first = client.jar.get('session');
  await client.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD });
  assert.notEqual(client.jar.get('session'), first);
});

test('garbage or forged cookies are rejected', async () => {
  const client = env.client();
  for (const value of ['', 'abc', 'x'.repeat(43), '%00%01']) {
    client.jar.set('session', value);
    assert.equal((await client.get('/api/auth/me')).status, 401);
  }
});

// ---------- logout ----------

test('logout revokes the session on the server and clears the cookie', async () => {
  const client = await signedIn(env);
  const token = client.jar.get('session');
  const res = await client.post('/api/auth/logout');
  assert.equal(res.status, 204);
  assert.match(res.headers.get('set-cookie'), /^session=; .*Max-Age=0/);

  // Replaying the old cookie does not work: the session is revoked, not just forgotten.
  client.jar.set('session', token);
  assert.equal((await client.get('/api/auth/me')).status, 401);
});

test('logout without a session still succeeds', async () => {
  assert.equal((await env.client().post('/api/auth/logout')).status, 204);
});

test('logout-all signs out every device', async () => {
  const laptop = await signedIn(env);
  const phone = env.client();
  await phone.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD });
  const other = await signedIn(env, 'ben@example.com');

  assert.equal((await phone.post('/api/auth/logout-all')).status, 204);
  assert.equal((await laptop.get('/api/auth/me')).status, 401);
  assert.equal((await phone.get('/api/auth/me')).status, 401);
  assert.equal((await other.get('/api/auth/me')).status, 200, "another user's sessions are untouched");
  assert.equal((await env.client().post('/api/auth/logout-all')).status, 401);
});

// ---------- email verification ----------

test('the verification link verifies the email once', async () => {
  const client = await signedIn(env);
  const token = env.lastLink('verify');
  const anyone = env.client(); // the link works without being signed in
  assert.equal((await anyone.post('/api/auth/verify-email', { token })).status, 200);
  assert.equal((await client.get('/api/auth/me')).json.user.emailVerified, true);
  assert.equal((await anyone.post('/api/auth/verify-email', { token })).json.error, 'invalid_token', 'single use');
});

test('verification links expire after 24 hours', async () => {
  await signedIn(env);
  const token = env.lastLink('verify');
  env.advance(DAY);
  assert.equal((await env.client().post('/api/auth/verify-email', { token })).json.error, 'invalid_token');
});

test('bad verification tokens are rejected', async () => {
  const client = env.client();
  for (const token of [undefined, '', 'nope', 123]) {
    const res = await client.post('/api/auth/verify-email', { token });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'invalid_token');
  }
});

test('resending verification replaces the old link and is rate limited', async () => {
  const client = await signedIn(env);
  const first = env.lastLink('verify');
  assert.equal((await client.post('/api/auth/resend-verification')).status, 202);
  const second = env.lastLink('verify');
  assert.notEqual(first, second);
  assert.equal((await env.client().post('/api/auth/verify-email', { token: first })).status, 400, 'old link retired');

  await client.post('/api/auth/resend-verification');
  await client.post('/api/auth/resend-verification');
  assert.equal((await client.post('/api/auth/resend-verification')).status, 429);

  assert.equal((await env.client().post('/api/auth/verify-email', { token: env.lastLink('verify') })).status, 200);
  assert.equal((await client.post('/api/auth/resend-verification')).json.status, 'already_verified');
  assert.equal((await env.client().post('/api/auth/resend-verification')).status, 401);
});

// ---------- password reset ----------

test('password reset: link, new password works, old one does not, all sessions revoked', async () => {
  const oldDevice = await signedIn(env);
  const anon = env.client();
  assert.equal((await anon.post('/api/auth/password/forgot', { email: 'ANA@example.com' })).status, 202);
  const token = env.lastLink('reset');
  assert.ok(token);

  const res = await anon.post('/api/auth/password/reset', { token, password: 'a brand new password' });
  assert.equal(res.status, 200);
  assert.equal(res.json.user.emailVerified, true, 'using the emailed link proves the inbox');
  assert.ok(anon.jar.get('session'), 'signed in with a fresh session');

  assert.equal((await oldDevice.get('/api/auth/me')).status, 401, 'old sessions revoked');
  assert.equal((await env.client().post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD })).status, 401);
  assert.equal((await env.client().post('/api/auth/login', { email: 'ana@example.com', password: 'a brand new password' })).status, 200);
  assert.match(env.sent.at(-1).subject, /password was changed/);

  assert.equal((await anon.post('/api/auth/password/reset', { token, password: 'yet another one' })).json.error, 'invalid_token', 'single use');
});

test('forgot-password gives the same answer for unknown emails and sends nothing', async () => {
  const res = await env.client().post('/api/auth/password/forgot', { email: 'nobody@example.com' });
  assert.equal(res.status, 202);
  assert.deepEqual(res.json, { status: 'check_email' });
  assert.equal(env.sent.length, 0);
});

test('reset links expire after 30 minutes and a newer link replaces an older one', async () => {
  await signedIn(env);
  const anon = env.client();
  await anon.post('/api/auth/password/forgot', { email: 'ana@example.com' });
  const first = env.lastLink('reset');
  await anon.post('/api/auth/password/forgot', { email: 'ana@example.com' });
  const second = env.lastLink('reset');
  assert.equal((await anon.post('/api/auth/password/reset', { token: first, password: 'new password 1' })).status, 400);

  env.advance(30 * MINUTE);
  assert.equal((await anon.post('/api/auth/password/reset', { token: second, password: 'new password 2' })).status, 400);
});

test('a verification token cannot be used as a reset token', async () => {
  await signedIn(env);
  const verifyToken = env.lastLink('verify');
  const res = await env.client().post('/api/auth/password/reset', { token: verifyToken, password: 'new password here' });
  assert.equal(res.json.error, 'invalid_token');
});

test('reset enforces the password policy without using up the token', async () => {
  await signedIn(env);
  const anon = env.client();
  await anon.post('/api/auth/password/forgot', { email: 'ana@example.com' });
  const token = env.lastLink('reset');
  assert.equal((await anon.post('/api/auth/password/reset', { token, password: 'short' })).json.error, 'password_too_short');
  assert.equal((await anon.post('/api/auth/password/reset', { token, password: 'long enough now' })).status, 200);
});

test('forgot-password sends at most 3 emails per address per hour, silently', async () => {
  await signedIn(env);
  const before = env.sent.length;
  const anon = env.client();
  for (let i = 0; i < 5; i++) {
    const res = await anon.post('/api/auth/password/forgot', { email: 'ana@example.com' });
    assert.equal(res.status, 202, 'always the same answer');
  }
  assert.equal(env.sent.length - before, 3);
  env.advance(HOUR);
  await anon.post('/api/auth/password/forgot', { email: 'ana@example.com' });
  assert.equal(env.sent.length - before, 4);
});

// ---------- change password ----------

test('change password needs the current password, then signs out other devices', async () => {
  const laptop = await signedIn(env);
  const phone = env.client();
  await phone.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD });
  const oldToken = laptop.jar.get('session');

  const wrong = await laptop.post('/api/auth/password/change', { currentPassword: 'nope nope', newPassword: 'new password ok' });
  assert.equal(wrong.status, 401);

  const weak = await laptop.post('/api/auth/password/change', { currentPassword: PASSWORD, newPassword: 'short' });
  assert.equal(weak.json.error, 'password_too_short');

  const ok = await laptop.post('/api/auth/password/change', { currentPassword: PASSWORD, newPassword: 'new password ok' });
  assert.equal(ok.status, 200);
  assert.notEqual(laptop.jar.get('session'), oldToken, 'this device gets a new session');
  assert.equal((await laptop.get('/api/auth/me')).status, 200);
  assert.equal((await phone.get('/api/auth/me')).status, 401);
  assert.equal((await env.client().post('/api/auth/login', { email: 'ana@example.com', password: 'new password ok' })).status, 200);
  assert.equal((await env.client().post('/api/auth/password/change', {})).status, 401, 'needs a session');
});

// ---------- delete account ----------

test('delete account needs the password and removes the user, sessions and todos', async () => {
  const client = await signedIn(env);
  await client.post('/api/todos', { text: 'secret plan' });
  assert.equal((await client.del('/api/auth/account', { password: 'wrong one!' })).status, 401);

  const res = await client.del('/api/auth/account', { password: PASSWORD });
  assert.equal(res.status, 204);
  for (const table of ['users', 'password_credentials', 'sessions', 'auth_tokens', 'todos']) {
    assert.equal(env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.equal((await client.get('/api/auth/me')).status, 401);
  // The email is free to sign up again.
  await env.client().post('/api/auth/signup', { email: 'ana@example.com', password: 'fresh start pw' });
  assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

// ---------- rate limiting ----------

test('5 failed logins lock that email for 15 minutes, even with the right password', async () => {
  const client = env.client();
  await client.post('/api/auth/signup', { email: 'ana@example.com', password: PASSWORD });
  for (let i = 0; i < 5; i++) {
    assert.equal((await client.post('/api/auth/login', { email: 'ana@example.com', password: 'wrong guess' })).status, 401);
  }
  const blocked = await client.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');

  env.advance(15 * MINUTE);
  assert.equal((await client.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD })).status, 200);
});

test('a successful login clears earlier failures', async () => {
  const client = env.client();
  await client.post('/api/auth/signup', { email: 'ana@example.com', password: PASSWORD });
  for (let i = 0; i < 4; i++) await client.post('/api/auth/login', { email: 'ana@example.com', password: 'wrong guess' });
  assert.equal((await client.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD })).status, 200);
  for (let i = 0; i < 4; i++) await client.post('/api/auth/login', { email: 'ana@example.com', password: 'wrong guess' });
  assert.equal((await client.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD })).status, 200);
});

test('one IP gets 20 login attempts per 10 minutes across all emails', async () => {
  const client = env.client();
  for (let i = 0; i < 20; i++) {
    const res = await client.post('/api/auth/login', { email: `user${i}@example.com`, password: 'whatever pw' });
    assert.equal(res.status, 401);
  }
  assert.equal((await client.post('/api/auth/login', { email: 'user99@example.com', password: 'whatever pw' })).status, 429);
  env.advance(10 * MINUTE);
  assert.equal((await client.post('/api/auth/login', { email: 'user99@example.com', password: 'whatever pw' })).status, 401);
});

test('signup is limited to 10 per IP per hour', async () => {
  const client = env.client();
  for (let i = 0; i < 10; i++) {
    assert.equal((await client.post('/api/auth/signup', { email: `u${i}@example.com`, password: PASSWORD })).status, 202);
  }
  assert.equal((await client.post('/api/auth/signup', { email: 'u10@example.com', password: PASSWORD })).status, 429);
});

test('X-Forwarded-For is ignored unless trustProxy is on', async () => {
  const client = env.client();
  for (let i = 0; i < 20; i++) {
    await client.post('/api/auth/login', { email: `u${i}@example.com`, password: 'x'.repeat(8) }, { headers: { 'x-forwarded-for': `10.0.0.${i}` } });
  }
  const res = await client.post('/api/auth/login', { email: 'u@example.com', password: 'x'.repeat(8) }, { headers: { 'x-forwarded-for': '10.9.9.9' } });
  assert.equal(res.status, 429, 'spoofed header does not dodge the per-IP limit');

  await env.close();
  env = await startApp({ appOptions: { trustProxy: true } });
  const proxied = env.client();
  for (let i = 0; i < 25; i++) {
    const r = await proxied.post('/api/auth/login', { email: `u${i}@example.com`, password: 'x'.repeat(8) }, { headers: { 'x-forwarded-for': `10.0.0.${i}, 127.0.0.1` } });
    assert.equal(r.status, 401);
  }
});

// ---------- housekeeping ----------

test('purgeExpired deletes revoked or expired sessions and used or expired tokens', async () => {
  const keep = await signedIn(env, 'ana@example.com', PASSWORD, true);
  const gone = env.client();
  await gone.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD });
  await gone.post('/api/auth/logout');
  await env.client().post('/api/auth/password/forgot', { email: 'ana@example.com' });

  // 1 revoked session; tokens: 1 verify (24h) + 1 reset (30 min), both unused.
  assert.deepEqual(env.app.purgeExpired(), { sessions: 1, tokens: 0 });
  env.advance(HOUR);
  assert.deepEqual(env.app.purgeExpired(), { sessions: 0, tokens: 1 }, 'reset token expired');
  assert.equal((await keep.get('/api/auth/me')).status, 200);
  env.advance(SESSION.idleLong);
  assert.deepEqual(env.app.purgeExpired(), { sessions: 1, tokens: 1 });
});

test('a failing mailer never breaks signup or forgot-password', async () => {
  await env.close();
  env = await startApp({ mailer: { send: async () => { throw new Error('smtp down'); } } });
  const client = env.client();
  assert.equal((await client.post('/api/auth/signup', { email: 'ana@example.com', password: PASSWORD })).status, 202);
  assert.equal((await client.post('/api/auth/password/forgot', { email: 'ana@example.com' })).status, 202);
  assert.equal((await client.post('/api/auth/login', { email: 'ana@example.com', password: PASSWORD })).status, 200);
});
