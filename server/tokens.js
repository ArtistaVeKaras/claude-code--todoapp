// Random secrets for session cookies and email links.
// Only the SHA-256 of a secret is stored, so a leaked database cannot be used to sign in.

const crypto = require('node:crypto');

function newSecret() {
  return crypto.randomBytes(32).toString('base64url'); // 256 bits
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest('hex');
}

function newId() {
  return crypto.randomUUID();
}

module.exports = { newSecret, hashSecret, newId };
