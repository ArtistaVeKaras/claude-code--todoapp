// The auth + todos API and the static file server, as one request handler.
// createApp() takes its database, mailer, password hasher and clock as arguments,
// so the tests can run it against an in-memory database with a fake clock.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { HttpError, readJson, sendJson, parseCookies, serializeCookie } = require('./http');
const { createHasher, checkPasswordPolicy } = require('./passwords');
const { createRateLimiter } = require('./rate-limit');
const { newSecret, hashSecret, newId } = require('./tokens');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const SESSION = {
  idleShort: DAY, // without "remember me"
  idleLong: 30 * DAY, // with "remember me"
  absolute: 90 * DAY, // hard cap, whatever the activity
  touchEvery: 5 * MINUTE, // write last_seen_at at most this often
};

const TOKEN_TTL = {
  verify_email: DAY,
  reset_password: 30 * MINUTE,
};

const TODO_MAX_LENGTH = 200;
const TODO_MAX_PER_USER = 5000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The four files the browser needs. Nothing else in the repo is served.
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/i18n.js': ['i18n.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

function createApp({
  db,
  mailer,
  hasher = createHasher(),
  now = Date.now,
  appUrl = 'http://localhost:3000',
  secureCookies = false,
  trustProxy = false,
  staticDir = path.join(__dirname, '..'),
  log = console.error,
}) {
  const limiter = createRateLimiter({ now });
  const cookieName = secureCookies ? '__Host-session' : 'session';
  const appOrigin = new URL(appUrl).origin;

  // ---------- database helpers ----------

  const sql = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, email_verified_at, created_at) VALUES (?, ?, NULL, ?)'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    verifyUser: db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ? AND email_verified_at IS NULL'),
    credential: db.prepare('SELECT * FROM password_credentials WHERE user_id = ?'),
    upsertCredential: db.prepare(
      `INSERT INTO password_credentials (user_id, password_hash, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`
    ),
    insertSession: db.prepare(
      `INSERT INTO sessions (id_hash, user_id, created_at, last_seen_at, expires_at, persistent, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    sessionByHash: db.prepare('SELECT * FROM sessions WHERE id_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?'),
    revokeSession: db.prepare('UPDATE sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL'),
    revokeUserSessions: db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'),
    insertToken: db.prepare(
      'INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)'
    ),
    retireTokens: db.prepare(
      'UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL'
    ),
    tokenByHash: db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?'),
    useToken: db.prepare('UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL'),
    // Same boundaries as the checks in currentSession() and consumeToken(): expired at t >= expires_at.
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL OR created_at <= ?'),
    purgeTokens: db.prepare('DELETE FROM auth_tokens WHERE expires_at <= ? OR used_at IS NOT NULL'),
    listTodos: db.prepare('SELECT id, text, done FROM todos WHERE user_id = ? ORDER BY position'),
    countTodos: db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS maxPos FROM todos WHERE user_id = ?'),
    insertTodo: db.prepare(
      'INSERT INTO todos (id, user_id, text, done, created_at, position) VALUES (?, ?, ?, 0, ?, ?)'
    ),
    todo: db.prepare('SELECT id, text, done FROM todos WHERE id = ? AND user_id = ?'),
    setTodoDone: db.prepare('UPDATE todos SET done = ? WHERE id = ? AND user_id = ?'),
    deleteTodo: db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?'),
    clearCompleted: db.prepare('DELETE FROM todos WHERE user_id = ? AND done = 1'),
  };

  function transaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const publicUser = (user) => ({ id: user.id, email: user.email, emailVerified: Boolean(user.email_verified_at) });
  const publicTodo = (row) => ({ id: row.id, text: row.text, done: Boolean(row.done) });

  // ---------- sessions ----------

  function createSession(res, req, userId, persistent) {
    const secret = newSecret();
    const t = now();
    const idle = persistent ? SESSION.idleLong : SESSION.idleShort;
    sql.insertSession.run(
      hashSecret(secret),
      userId,
      t,
      t,
      t + idle,
      persistent ? 1 : 0,
      clientIp(req),
      String(req.headers['user-agent'] || '').slice(0, 300)
    );
    // Without "remember me" the cookie has no Max-Age, so the browser drops it on close.
    const maxAgeSeconds = persistent ? Math.floor(SESSION.absolute / 1000) : undefined;
    res.setHeader('Set-Cookie', serializeCookie(cookieName, secret, { maxAgeSeconds, secure: secureCookies }));
  }

  function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', serializeCookie(cookieName, '', { maxAgeSeconds: 0, secure: secureCookies }));
  }

  // Returns { user, sessionHash } for a valid session, or null.
  function currentSession(req) {
    const secret = parseCookies(req.headers.cookie)[cookieName];
    if (!secret) return null;
    const idHash = hashSecret(secret);
    const session = sql.sessionByHash.get(idHash);
    const t = now();
    if (!session || session.revoked_at !== null) return null;
    if (t >= session.expires_at || t >= session.created_at + SESSION.absolute) return null;
    if (t - session.last_seen_at >= SESSION.touchEvery) {
      const idle = session.persistent ? SESSION.idleLong : SESSION.idleShort;
      sql.touchSession.run(t, Math.min(t + idle, session.created_at + SESSION.absolute), idHash);
    }
    const user = sql.userById.get(session.user_id);
    return user ? { user, sessionHash: idHash } : null;
  }

  function requireAuth(req) {
    const auth = currentSession(req);
    if (!auth) throw new HttpError(401, 'not_authenticated');
    return auth;
  }

  // ---------- email links ----------

  function issueToken(userId, purpose) {
    const secret = newSecret();
    // A newer link replaces any older unused link for the same purpose.
    sql.retireTokens.run(now(), userId, purpose);
    sql.insertToken.run(hashSecret(secret), userId, purpose, now() + TOKEN_TTL[purpose]);
    return secret;
  }

  // Marks the token used and returns its row, or throws if it is unknown, used or expired.
  function consumeToken(secret, purpose) {
    if (typeof secret !== 'string' || !secret) throw new HttpError(400, 'invalid_token');
    const tokenHash = hashSecret(secret);
    const row = sql.tokenByHash.get(tokenHash, purpose);
    if (!row || row.used_at !== null || now() >= row.expires_at) throw new HttpError(400, 'invalid_token');
    const { changes } = sql.useToken.run(now(), tokenHash);
    if (changes !== 1) throw new HttpError(400, 'invalid_token');
    return row;
  }

  async function sendMail(message) {
    try {
      await mailer.send(message);
    } catch (err) {
      // Never fail the request (or reveal anything) because email delivery failed.
      log('email delivery failed:', err);
    }
  }

  async function sendVerificationEmail(user) {
    const token = issueToken(user.id, 'verify_email');
    await sendMail({
      to: user.email,
      subject: 'Confirm your email for TODO App',
      text: `Confirm your email address by opening this link within 24 hours:\n\n${appUrl}/?verify=${token}\n\nIf you did not create an account, you can ignore this email.`,
    });
  }

  // ---------- request helpers ----------

  function clientIp(req) {
    if (trustProxy) {
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwarded) return forwarded;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  function normalizeEmail(value) {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
  }

  function limit(key, max, windowMs) {
    const result = limiter.take(key, max, windowMs);
    if (!result.ok) {
      throw new HttpError(429, 'too_many_requests', { retryAfter: Math.ceil(result.retryAfterMs / 1000) });
    }
  }

  // Cross-site request forgery: the cookie is SameSite=Lax, and on top of that every
  // state-changing API call must be a JSON request from this site's own origin.
  function checkCsrf(req) {
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') throw new HttpError(415, 'json_required');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'bad_origin');
    const origin = req.headers.origin;
    if (origin && origin !== appOrigin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) {
      throw new HttpError(403, 'bad_origin');
    }
  }

  // ---------- auth routes ----------

  async function signup(req, res) {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, 'invalid_email');
    const policyError = checkPasswordPolicy(body.password);
    if (policyError) throw new HttpError(400, policyError);
    limit(`signup-ip:${clientIp(req)}`, 10, HOUR);

    // Hash first either way, so a taken email answers in the same time as a new one.
    const passwordHash = await hasher.hash(body.password);
    const existing = sql.userByEmail.get(email);
    if (existing) {
      await sendMail({
        to: email,
        subject: 'Someone tried to sign up with your email',
        text: `Someone tried to create a TODO App account with this email, but you already have one.\nSign in at ${appUrl}/ or reset your password there if you have forgotten it.`,
      });
    } else {
      const user = { id: newId(), email, email_verified_at: null };
      transaction(() => {
        sql.insertUser.run(user.id, email, now());
        sql.upsertCredential.run(user.id, passwordHash, now());
      });
      await sendVerificationEmail(user);
    }
    // Same answer for new and taken emails: the client signs in next.
    sendJson(res, 202, { status: 'check_email' });
  }

  async function login(req, res) {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';
    limit(`login-ip:${clientIp(req)}`, 20, 10 * MINUTE);

    const failKey = `login-fail:${email}`;
    const failures = limiter.check(failKey, 5, 15 * MINUTE);
    if (!failures.ok) {
      throw new HttpError(429, 'too_many_requests', { retryAfter: Math.ceil(failures.retryAfterMs / 1000) });
    }

    const user = email ? sql.userByEmail.get(email) : null;
    const credential = user ? sql.credential.get(user.id) : null;
    const stored = credential ? credential.password_hash : await hasher.dummyHash();
    const ok = (await hasher.verify(password, stored)) && Boolean(credential) && password.length > 0;

    if (!ok) {
      if (email) limiter.hit(failKey, 15 * MINUTE);
      throw new HttpError(401, 'invalid_credentials');
    }

    limiter.reset(failKey);
    if (hasher.needsRehash(credential.password_hash)) {
      sql.upsertCredential.run(user.id, await hasher.hash(password), now());
    }
    createSession(res, req, user.id, body.remember === true);
    sendJson(res, 200, { user: publicUser(user) });
  }

  async function logout(req, res) {
    const auth = currentSession(req);
    if (auth) sql.revokeSession.run(now(), auth.sessionHash);
    clearSessionCookie(res);
    sendJson(res, 204);
  }

  async function logoutAll(req, res) {
    const { user } = requireAuth(req);
    sql.revokeUserSessions.run(now(), user.id);
    clearSessionCookie(res);
    sendJson(res, 204);
  }

  async function me(req, res) {
    const { user } = requireAuth(req);
    sendJson(res, 200, { user: publicUser(user) });
  }

  async function verifyEmail(req, res) {
    const body = await readJson(req);
    limit(`verify-ip:${clientIp(req)}`, 30, HOUR);
    const token = consumeToken(body.token, 'verify_email');
    sql.verifyUser.run(now(), token.user_id);
    sendJson(res, 200, { status: 'verified' });
  }

  async function resendVerification(req, res) {
    const { user } = requireAuth(req);
    if (user.email_verified_at) return sendJson(res, 200, { status: 'already_verified' });
    limit(`resend:${user.id}`, 3, HOUR);
    await sendVerificationEmail(user);
    sendJson(res, 202, { status: 'check_email' });
  }

  async function forgotPassword(req, res) {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, 'invalid_email');
    limit(`forgot-ip:${clientIp(req)}`, 10, HOUR);

    const user = sql.userByEmail.get(email);
    // Past the per-email limit we still answer 202, just without sending more mail.
    if (user && limiter.take(`forgot-email:${email}`, 3, HOUR).ok) {
      const token = issueToken(user.id, 'reset_password');
      await sendMail({
        to: email,
        subject: 'Reset your TODO App password',
        text: `Reset your password by opening this link within 30 minutes:\n\n${appUrl}/?reset=${token}\n\nIf you did not ask for this, you can ignore this email; your password has not changed.`,
      });
    }
    sendJson(res, 202, { status: 'check_email' });
  }

  async function resetPassword(req, res) {
    const body = await readJson(req);
    limit(`reset-ip:${clientIp(req)}`, 20, HOUR);
    const policyError = checkPasswordPolicy(body.password);
    if (policyError) throw new HttpError(400, policyError);
    const token = consumeToken(body.token, 'reset_password');
    const user = sql.userById.get(token.user_id);
    if (!user) throw new HttpError(400, 'invalid_token');

    const passwordHash = await hasher.hash(body.password);
    transaction(() => {
      sql.upsertCredential.run(user.id, passwordHash, now());
      sql.revokeUserSessions.run(now(), user.id);
      sql.verifyUser.run(now(), user.id); // the link proved they own the inbox
    });
    await sendMail({
      to: user.email,
      subject: 'Your TODO App password was changed',
      text: 'Your password was just reset and you were signed out everywhere else. If this was not you, reset it again right away.',
    });
    createSession(res, req, user.id, false);
    sendJson(res, 200, { user: publicUser(sql.userById.get(user.id)) });
  }

  async function changePassword(req, res) {
    const { user } = requireAuth(req);
    const body = await readJson(req);
    limit(`change-password:${user.id}`, 5, 15 * MINUTE);
    const credential = sql.credential.get(user.id);
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    if (!credential || !(await hasher.verify(current, credential.password_hash))) {
      throw new HttpError(401, 'invalid_credentials');
    }
    const policyError = checkPasswordPolicy(body.newPassword);
    if (policyError) throw new HttpError(400, policyError);

    const passwordHash = await hasher.hash(body.newPassword);
    transaction(() => {
      sql.upsertCredential.run(user.id, passwordHash, now());
      sql.revokeUserSessions.run(now(), user.id);
    });
    await sendMail({
      to: user.email,
      subject: 'Your TODO App password was changed',
      text: 'Your password was just changed and other devices were signed out. If this was not you, reset your password right away.',
    });
    // A fresh session for this device; every other session is now revoked.
    createSession(res, req, user.id, body.remember === true);
    sendJson(res, 200, { user: publicUser(user) });
  }

  async function deleteAccount(req, res) {
    const { user } = requireAuth(req);
    const body = await readJson(req);
    limit(`delete-account:${user.id}`, 5, 15 * MINUTE);
    const credential = sql.credential.get(user.id);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!credential || !(await hasher.verify(password, credential.password_hash))) {
      throw new HttpError(401, 'invalid_credentials');
    }
    sql.deleteUser.run(user.id); // sessions, tokens and todos go with it (ON DELETE CASCADE)
    clearSessionCookie(res);
    sendJson(res, 204);
  }

  // ---------- todo routes (every query is scoped to the signed-in user) ----------

  async function listTodos(req, res) {
    const { user } = requireAuth(req);
    sendJson(res, 200, { todos: sql.listTodos.all(user.id).map(publicTodo) });
  }

  async function createTodo(req, res) {
    const { user } = requireAuth(req);
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpError(400, 'text_required');
    if ([...text].length > TODO_MAX_LENGTH) throw new HttpError(400, 'text_too_long');
    const { n, maxPos } = sql.countTodos.get(user.id);
    if (n >= TODO_MAX_PER_USER) throw new HttpError(400, 'too_many_todos');
    const id = newId();
    sql.insertTodo.run(id, user.id, text, now(), maxPos + 1);
    sendJson(res, 201, { todo: publicTodo(sql.todo.get(id, user.id)) });
  }

  async function updateTodo(req, res, id) {
    const { user } = requireAuth(req);
    const body = await readJson(req);
    if (typeof body.done !== 'boolean') throw new HttpError(400, 'done_required');
    const { changes } = sql.setTodoDone.run(body.done ? 1 : 0, id, user.id);
    if (changes === 0) throw new HttpError(404, 'not_found');
    sendJson(res, 200, { todo: publicTodo(sql.todo.get(id, user.id)) });
  }

  async function removeTodo(req, res, id) {
    const { user } = requireAuth(req);
    const { changes } = sql.deleteTodo.run(id, user.id);
    if (changes === 0) throw new HttpError(404, 'not_found');
    sendJson(res, 204);
  }

  async function clearCompletedTodos(req, res) {
    const { user } = requireAuth(req);
    const { changes } = sql.clearCompleted.run(user.id);
    sendJson(res, 200, { removed: Number(changes) });
  }

  // ---------- routing ----------

  const routes = {
    'POST /api/auth/signup': signup,
    'POST /api/auth/login': login,
    'POST /api/auth/logout': logout,
    'POST /api/auth/logout-all': logoutAll,
    'GET /api/auth/me': me,
    'POST /api/auth/verify-email': verifyEmail,
    'POST /api/auth/resend-verification': resendVerification,
    'POST /api/auth/password/forgot': forgotPassword,
    'POST /api/auth/password/reset': resetPassword,
    'POST /api/auth/password/change': changePassword,
    'DELETE /api/auth/account': deleteAccount,
    'GET /api/todos': listTodos,
    'POST /api/todos': createTodo,
    'POST /api/todos/clear-completed': clearCompletedTodos,
  };

  async function handleApi(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') checkCsrf(req);
    const route = routes[`${req.method} ${pathname}`];
    if (route) return route(req, res);

    const match = /^\/api\/todos\/([A-Za-z0-9-]{1,64})$/.exec(pathname);
    if (match && req.method === 'PATCH') return updateTodo(req, res, match[1]);
    if (match && req.method === 'DELETE') return removeTodo(req, res, match[1]);
    throw new HttpError(404, 'not_found');
  }

  // ---------- static files ----------

  // Read on every request (the files are tiny), so edits show up without a restart.
  function readStatic(file) {
    return fs.readFileSync(path.join(staticDir, file));
  }

  // Allow index.html's small inline theme script by its hash, and no other inline script.
  function contentSecurityPolicy() {
    const html = readStatic('index.html').toString('utf8');
    const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
      (m) => `'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`
    );
    return [
      "default-src 'self'",
      `script-src 'self' ${hashes.join(' ')}`.trim(),
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
  }
  function serveStatic(req, res, pathname) {
    const entry = STATIC_FILES[pathname];
    if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const [file, type] = entry;
    const body = readStatic(file);
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': contentSecurityPolicy(),
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  function setSecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); // keeps ?reset= tokens out of Referer headers
    res.setHeader('X-Frame-Options', 'DENY');
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  async function handler(req, res) {
    setSecurityHeaders(res);
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return sendJson(res, 400, { error: 'bad_request' });
    }
    try {
      if (pathname === '/api' || pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
      return serveStatic(req, res, pathname);
    } catch (err) {
      if (err instanceof HttpError) {
        const headers = err.extra.retryAfter ? { 'Retry-After': String(err.extra.retryAfter) } : {};
        if (!res.headersSent) sendJson(res, err.status, { error: err.code }, headers);
        return;
      }
      log('unhandled error:', err);
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
    }
  }

  // Deletes expired or revoked sessions and used or expired tokens. server.js runs it hourly.
  function purgeExpired() {
    const t = now();
    const sessions = sql.purgeSessions.run(t, t - SESSION.absolute).changes;
    const tokens = sql.purgeTokens.run(t).changes;
    limiter.sweep();
    return { sessions: Number(sessions), tokens: Number(tokens) };
  }

  return { handler, purgeExpired, cookieName };
}

module.exports = { createApp, SESSION, TOKEN_TTL, TODO_MAX_LENGTH };
