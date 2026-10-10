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
