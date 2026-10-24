// Browser tests. They use the Microsoft Edge that is already installed (channel 'msedge'),
// so no browser is downloaded. Each run starts a fresh server on port 3100 with a fresh database.
const os = require('node:os');
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const PORT = 3100;
// `--headed` runs are for people to watch: one test at a time, slowed down so each step is visible.
const headed = process.argv.includes('--headed');
const root = path.join(__dirname, '..', '..');
const databasePath = path.join(os.tmpdir(), `todo-e2e-${process.pid}-${Date.now()}.db`);

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'msedge',
    locale: 'en-GB',
    timezoneId: 'Europe/Lisbon',
    trace: 'retain-on-failure',
    launchOptions: { slowMo: headed ? 400 : 0 },
  },
  // Slowed-down steps need more than the default 30 s per test.
  timeout: headed ? 120000 : 30000,
  webServer: {
    command: 'node server/server.js',
    cwd: root,
    // The page itself; it is served as soon as the server is up.
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      APP_URL: `http://localhost:${PORT}`,
      DATABASE_PATH: databasePath,
      // Lets each test send its own X-Forwarded-For, so the per-IP sign-up and sign-in limits
      // (10 per hour, 20 per 10 minutes) do not stop a run that makes many accounts.
      TRUST_PROXY: '1',
    },
  },
});
