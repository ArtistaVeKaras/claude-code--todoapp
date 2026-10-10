// SQLite storage using Node's built-in node:sqlite module (Node 22.13+ or 23.4+).
// No packages to install. Pass ':memory:' for a throwaway database (used by the tests).

const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email_verified_at INTEGER,
    created_at        INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_credentials (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id_hash      TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    persistent   INTEGER NOT NULL,
    ip           TEXT,
    user_agent   TEXT,
    revoked_at   INTEGER
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );
  CREATE INDEX IF NOT EXISTS auth_tokens_user ON auth_tokens(user_id, purpose);

  CREATE TABLE IF NOT EXISTS todos (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    position   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS todos_user ON todos(user_id, position);
`;

function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDatabase };
