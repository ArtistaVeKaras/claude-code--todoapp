// Test helpers: an app on a random port with an in-memory database, a fake clock,
// a mailer that records messages, and a small HTTP client with its own cookie jar.

const http = require('node:http');
const path = require('node:path');

const { openDatabase } = require('../server/db');
const { createApp } = require('../server/app');
const { createHasher } = require('../server/passwords');

// Cheap scrypt settings so the suite runs fast. Production uses DEFAULT_PARAMS.
const FAST_HASH = { N: 2 ** 10, r: 8, p: 1 };

async function startApp(options = {}) {
  const clock = { t: Date.UTC(2026, 9, 10, 9, 0, 0) };
  const sent = [];
  const mailer = options.mailer || { send: async (message) => sent.push(message) };
  const db = openDatabase(':memory:');
  const app = createApp({
    db,
    mailer,
    hasher: options.hasher || createHasher(FAST_HASH),
    now: () => clock.t,
    appUrl: 'http://localhost:3000',
    staticDir: path.join(__dirname, '..'),
    log: () => {},
    ...options.appOptions,
  });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    app,
    db,
    base,
    sent,
    clock,
    advance(ms) {
      clock.t += ms;
    },
    client: () => createClient(base),
    lastLink(kind) {
      for (let i = sent.length - 1; i >= 0; i--) {
        const match = new RegExp(`[?&]${kind}=([A-Za-z0-9_-]+)`).exec(sent[i].text);
        if (match) return match[1];
      }
      return null;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function createClient(base) {
  const jar = new Map();

  async function request(method, url, { body, headers = {}, raw } = {}) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const init = { method, headers: { ...headers } };
    if (cookie) init.headers.cookie = cookie;
    if (raw !== undefined) {
      init.body = raw;
    } else if (body !== undefined || (method !== 'GET' && method !== 'HEAD')) {
      init.headers['content-type'] = init.headers['content-type'] || 'application/json';
      init.body = JSON.stringify(body ?? {});
    }
    const res = await fetch(base + url, init);
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (attrs.some((a) => a.trim().toLowerCase() === 'max-age=0') || !value) jar.delete(name);
      else jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  }

  return {
    jar,
    get: (url, opts) => request('GET', url, opts),
    post: (url, body, opts = {}) => request('POST', url, { ...opts, body }),
    patch: (url, body, opts = {}) => request('PATCH', url, { ...opts, body }),
    del: (url, body, opts = {}) => request('DELETE', url, { ...opts, body }),
    request,
  };
}

// Signs up and signs in; returns the signed-in client.
async function signedIn(env, email = 'ana@example.com', password = 'correct horse battery', remember = false) {
  const client = env.client();
  await client.post('/api/auth/signup', { email, password });
  const res = await client.post('/api/auth/login', { email, password, remember });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.text}`);
  return client;
}

module.exports = { startApp, createClient, signedIn, FAST_HASH };
