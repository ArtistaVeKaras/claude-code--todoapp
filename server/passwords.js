// Password hashing with scrypt from node:crypto.
// The design doc names Argon2id, but Node 22 has no built-in Argon2 and this project
// installs no packages. scrypt with N=2^17, r=8, p=1 is OWASP's recommended scrypt setting.
// Stored format: scrypt$N$r$p$saltBase64$hashBase64 (the parameters travel with the hash,
// so they can be raised later and old hashes upgraded on the next login).

const crypto = require('node:crypto');

const DEFAULT_PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const KEY_LENGTH = 32;
const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

function scrypt(password, salt, { N, r, p }) {
  return new Promise((resolve, reject) => {
    // maxmem must exceed 128 * N * r bytes.
    crypto.scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

function createHasher(params = DEFAULT_PARAMS) {
  async function hash(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password.normalize('NFKC'), salt, params);
    return ['scrypt', params.N, params.r, params.p, salt.toString('base64'), key.toString('base64')].join('$');
  }

  async function verify(password, stored) {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, keyB64] = parts;
    const expected = Buffer.from(keyB64, 'base64');
    const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }

  function needsRehash(stored) {
    const [, N, r, p] = String(stored).split('$');
    return Number(N) !== params.N || Number(r) !== params.r || Number(p) !== params.p;
  }

  // A real hash of a random password, verified against on unknown emails so a login for
  // an unknown account takes as long as one for a known account.
  let dummy = null;
  async function dummyHash() {
    if (!dummy) dummy = await hash(crypto.randomBytes(16).toString('hex'));
    return dummy;
  }

  return { hash, verify, needsRehash, dummyHash };
}

// Returns an error code, or null if the password is acceptable.
// No composition rules, following NIST SP 800-63B: length is what matters.
function checkPasswordPolicy(password) {
  if (typeof password !== 'string') return 'password_required';
  const length = [...password].length;
  if (length < MIN_LENGTH) return 'password_too_short';
  if (length > MAX_LENGTH) return 'password_too_long';
  return null;
}

module.exports = { createHasher, checkPasswordPolicy, DEFAULT_PARAMS, MIN_LENGTH, MAX_LENGTH };
