const { test, expect, openAccount, addTask, addTasks, taskTexts, complete, modes, PASSWORD } = require('./helpers');

for (const { name, open } of modes) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      await open(page);
    });

    test('a new task shows a time label that says now, with a valid datetime and hidden full text', async ({ page }) => {
      await addTask(page, 'Buy milk');
      const time = page.locator('#todo-list li time');
      await expect(time).toHaveCount(1);
      await expect(time.locator('.todo-time-short')).toHaveText('now');
      const datetime = await time.getAttribute('datetime');
      expect(Number.isNaN(Date.parse(datetime))).toBe(false);
      expect(Math.abs(Date.now() - Date.parse(datetime))).toBeLessThan(5 * 60 * 1000);
      await expect(time.locator('.visually-hidden')).toHaveText(/^Added .+/);
    });

    test('the time label survives a reload', async ({ page }) => {
      await addTask(page, 'Buy milk');
      const before = await page.locator('#todo-list time').getAttribute('datetime');
      await page.reload();
      await expect(taskTexts(page)).toHaveText(['Buy milk']);
      await expect(page.locator('#todo-list time')).toHaveAttribute('datetime', before);
    });

    test('Clear all is hidden when the list is empty', async ({ page }) => {
      const clearAll = page.locator('#clear-all');
      await expect(clearAll).toBeHidden();
      await addTask(page, 'One');
      await expect(clearAll).toBeVisible();
    });

    test('the Clear all dialog focuses Cancel and Escape leaves the tasks unchanged', async ({ page }) => {
      await addTasks(page, ['One', 'Two']);
      await page.locator('#clear-all').click();
      const dialog = page.getByRole('dialog', { name: 'Clear all tasks?' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(taskTexts(page)).toHaveText(['One', 'Two']);
      await expect(page.locator('#undo-bar')).toBeHidden();
    });

    test('confirming Clear all empties the list and focuses Undo, and Undo restores the tasks in order with their times', async ({ page }) => {
      await addTasks(page, ['One', 'Two', 'Three']);
      const times = await page.locator('#todo-list time').evaluateAll((els) => els.map((el) => el.dateTime));
      await page.locator('#clear-all').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Clear all' }).click();
      await expect(taskTexts(page)).toHaveCount(0);
      await expect(page.locator('#clear-all')).toBeHidden();
      const undo = page.getByRole('button', { name: 'Undo' });
      await expect(undo).toBeFocused();
      await undo.click();
      await expect(taskTexts(page)).toHaveText(['One', 'Two', 'Three']);
      await expect(page.locator('#todo-list time')).toHaveCount(3);
      expect(await page.locator('#todo-list time').evaluateAll((els) => els.map((el) => el.dateTime))).toEqual(times);
      await expect(page.locator('#undo-bar')).toBeHidden();
    });

    test('Escape after an earlier Confirm does not clear the list', async ({ page }) => {
      await addTasks(page, ['One', 'Two']);
      await page.locator('#clear-all').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Clear all' }).click();
      await expect(taskTexts(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(taskTexts(page)).toHaveText(['One', 'Two']);
      await page.locator('#clear-all').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(taskTexts(page)).toHaveText(['One', 'Two']);
    });

    test('Clear completed then Undo puts the tasks back in their original positions', async ({ page }) => {
      await addTasks(page, ['A', 'B', 'C', 'D']);
      await complete(page, 'B');
      await complete(page, 'D');
      await page.getByRole('button', { name: 'Clear completed' }).click();
      await expect(taskTexts(page)).toHaveText(['A', 'C']);
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(taskTexts(page)).toHaveText(['A', 'B', 'C', 'D']);
      await expect(page.locator('#todo-list li').nth(1).getByRole('checkbox')).toBeChecked();
      await expect(page.locator('#todo-list li').nth(3).getByRole('checkbox')).toBeChecked();
    });

    test('Undo goes away after another action', async ({ page }) => {
      await addTasks(page, ['One', 'Two']);
      await page.locator('#clear-all').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Clear all' }).click();
      await expect(page.locator('#undo-bar')).toBeVisible();
      await addTask(page, 'Three');
      await expect(page.locator('#undo-bar')).toBeHidden();
      await expect(taskTexts(page)).toHaveText(['Three']);
    });

    test('a long task and its time label fit in 320 px with the time on its own row', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      const long = ('A very long task text that keeps going and going '.repeat(3) + 'x'.repeat(60)).slice(0, 200);
      await addTask(page, long);
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      expect(noScroll).toBe(true);
      const text = await page.locator('#todo-list .todo-text').boundingBox();
      const time = await page.locator('#todo-list time').boundingBox();
      expect(time.y).toBeGreaterThanOrEqual(text.y + text.height - 1);
      expect(time.x + time.width).toBeLessThanOrEqual(320);
    });

    test('in Portuguese the Clear all button says Limpar tudo and the full date is in pt-PT format', async ({ page }) => {
      await addTask(page, 'Comprar leite');
      const datetime = await page.locator('#todo-list time').getAttribute('datetime');
      await page.getByLabel('Language').selectOption('pt');
      await expect(page.locator('#clear-all')).toHaveText('Limpar tudo');
      await expect(page.locator('#todo-list time .todo-time-short')).toHaveText('agora');
      const full = page.locator('#todo-list time .visually-hidden');
      const expected = await page.evaluate(
        (ms) => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)),
        Date.parse(datetime)
      );
      await expect(full).toHaveText(`Adicionada em ${expected}`);
      // pt-PT (as this browser formats it) is day/month/year with a 24-hour time, not the English "24 Oct 2026, 12:33 am".
      await expect(full).toHaveText(/^Adicionada em \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);
    });
  });
}

test.describe('account mode only', () => {
  test('a task error is cleared by the next successful action', async ({ page }) => {
    await openAccount(page);
    await addTasks(page, ['Doomed', 'Other']);
    // Delete "Doomed" behind the page's back, through the API with the same session.
    const { todos } = await (await page.request.get('/api/todos')).json();
    const doomed = todos.find((todo) => todo.text === 'Doomed');
    const res = await page.request.delete(`/api/todos/${doomed.id}`, { data: {} });
    expect(res.ok()).toBe(true);

    await complete(page, 'Doomed');
    const status = page.locator('#status-message');
    await expect(status).toBeVisible();
    await expect(status).toContainText('This task no longer exists');

    await addTask(page, 'Fresh');
    await expect(status).toBeHidden();
  });

  test('Undo is not offered when the server returns no undo token', async ({ page }) => {
    await openAccount(page);
    await addTasks(page, ['A', 'B']);
    await complete(page, 'B');
    await page.route('**/api/todos/clear-completed', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ removed: 1 }) })
    );
    await page.getByRole('button', { name: 'Clear completed' }).click();
    await expect(taskTexts(page)).toHaveText(['A']);
    await expect(page.locator('#undo-bar')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  });

  test('tasks and their times stay on the server after signing out and in again', async ({ page }) => {
    const email = await openAccount(page);
    await addTask(page, 'Kept');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(taskTexts(page)).toHaveText(['Kept']);
    await expect(page.locator('#todo-list time')).toHaveCount(1);
  });
});
