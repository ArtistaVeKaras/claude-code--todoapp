// Starts the TODO app with accounts: serves the four app files and the /api routes.
//   npm start            (or: node server/server.js)
// Settings come from environment variables; every one has a development default.

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { createConsoleMailer } = require('./mailer');

const port = Number(process.env.PORT || 3000);
const appUrl = process.env.APP_URL || `http://localhost:${port}`;
const production = process.env.NODE_ENV === 'production';

const databasePath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'todo.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = openDatabase(databasePath);

const app = createApp({
  db,
  mailer: createConsoleMailer(),
  appUrl,
  // Secure, __Host- prefixed cookies need HTTPS; on by default in production.
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === '1' : production,
  // Only trust X-Forwarded-For when a reverse proxy you control sets it.
  trustProxy: process.env.TRUST_PROXY === '1',
});

setInterval(app.purgeExpired, 60 * 60 * 1000).unref();

http.createServer(app.handler).listen(port, () => {
  console.log(`TODO app running at ${appUrl}`);
  if (!production) console.log('Emails (verify and reset links) are printed here in development.');
});
