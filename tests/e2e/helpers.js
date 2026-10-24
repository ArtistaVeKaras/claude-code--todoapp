// Shared setup for the browser tests.
const { test, expect } = require('@playwright/test');

let counter = 0;
const PASSWORD = 'correct horse battery';

// A page in local mode: the API "does not exist", so the app stores tasks in localStorage.
async function openLocal(page) {
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await expect(page.locator('#todo-view')).toBeVisible();
}

// Signs up a new account through the page, then signs in (the page does both after one submit).
async function openAccount(page) {
  counter += 1;
  const email = `user-${process.pid}-${Date.now()}-${counter}@example.com`;
  // The server runs with TRUST_PROXY=1, so a unique address per account keeps the per-IP limits out of the way.
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${process.pid % 250}.${Math.floor(counter / 250) % 250}.${counter % 250}` });
  await page.goto('/');
  await page.getByRole('button', { name: 'No account yet? Create one' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.locator('#todo-view')).toBeVisible();
  await expect(page.locator('#account-email')).toHaveText(email);
  return email;
}

async function addTask(page, text) {
  await page.getByLabel('What needs to be done?').fill(text);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(rowOf(page, text)).toHaveCount(1);
}

async function addTasks(page, texts) {
  for (const text of texts) await addTask(page, text);
}

// The row whose task text is exactly this text (not the hidden "Added ..." text).
const rowOf = (page, text) => page.locator('#todo-list li').filter({ has: page.getByText(text, { exact: true }) });

const taskTexts = (page) => page.locator('#todo-list .todo-text');

// Ticks a task's checkbox by its text.
async function complete(page, text) {
  await rowOf(page, text).getByRole('checkbox').check();
}

// Each shared scenario runs in both modes.
const modes = [
  { name: 'local mode', open: openLocal },
  { name: 'account mode', open: openAccount },
];

module.exports = { test, expect, openLocal, openAccount, addTask, addTasks, taskTexts, rowOf, complete, modes, PASSWORD };
