# Manual browser checks

`npm test` cannot drive a browser, so these checks cover what it cannot: focus, dialogs, timers, layout and themes. Run each check twice.

- **Local mode:** open `index.html` as a file (or from a plain static server). Tasks live in this browser's localStorage.
- **Account mode:** run `npm start`, open the printed address and sign in. Tasks live on the server.

Start each section with a few tasks, some of them completed, unless the step says otherwise.

## Clear all dialog

1. With tasks on the list, click **Clear all**. The dialog opens and **Cancel** has focus.
2. Press Escape. The dialog closes and nothing is cleared.
3. Open it again and click **Cancel**. Nothing is cleared.
4. Open it again and click the confirm button. Every task is removed, completed ones included, and the list shows the empty message.
5. Add a task, click **Clear all**, and press Escape. The task is still there. Escape after an earlier Confirm must not clear anything.
6. Check that the dialog text names the right number of tasks (1, 2, 5), and that the count is correct in Polish (1, 3, 5, 12, 22).

## Clear all button visibility

1. With an empty list, **Clear all** is hidden.
2. Add one task. The button appears. Delete it. The button disappears again.
3. Reload with an empty list and check again.

## Undo after Clear all

1. Note the order, the texts, the done states and the time labels of the tasks. Click **Clear all** and confirm.
2. Focus is on the **Undo** button in the undo bar, and a screen reader announces the cleared message.
3. Press Enter on Undo. All tasks return in the original order, with the same done states and the same time labels (not "now").
4. Focus moves to the new-task field, the undo bar is gone, and a restored message is announced.

## Undo after Clear completed

1. Complete two of four tasks. Click **Clear completed**. The undo bar shows the completed-cleared message.
2. Click **Undo**. The completed tasks return in their original positions, still marked done.

## Undo goes away

1. Clear all, then do any other action: add a task, tick a task, delete a task, edit a task. The undo bar disappears each time.
2. Account mode: Clear all and leave the page alone for 15 minutes. The undo bar hides itself at 14 minutes 55 seconds. Local mode has no timer: the bar stays
until the next action. (Do not use the browser's time controls in a way that makes this unreliable.)
3. Clear all, then Clear completed on a new set of tasks. Only the latest clear can be undone.

## Undo after the server window (account mode only)

The page hides the bar at 14 minutes 55 seconds and the server keeps the undo for 15 minutes, so the expired message only shows when the page timer did not run
on time.

1. Clear all, then suspend the tab's timers for more than 15 minutes: put the computer to sleep, or pause the page in dev tools (Sources, Pause).
2. Resume and click **Undo** before the page timer hides the bar. If the bar is already gone, repeat with a faster click,
   or ask a developer to shorten the server window.
3. The undo expired message is shown in the page language, the tasks stay cleared, and the bar goes away.
4. Reload. The list is empty and no stale undo bar is shown.

## Time label

1. Add a task. The label at the end of the row says "now".
2. Within about 60 seconds, without reloading, it changes to "1 min". Later it counts up ("2 min", and so on).
3. Start editing another task and type some text. When the label changes, the edit field keeps its focus, caret and typed text.
4. Hover or focus the label to see the full date and time as its tooltip. A screen reader reads the time as part of the row.
5.  Tasks from earlier today show the clock time. Earlier this year they show the day and a short month name (for example "3 Mar"). Older ones also show the
   year. The tooltip is different: it uses the medium date style, which is numeric in Portuguese (for example "24/10/2026, 00:33") and has a short month name in
   English.

## Small screens

1. Set the window to 320 px wide (browser dev tools, no horizontal scrolling allowed).
2. Add a task with a very long text, once with spaces and once as one unbroken word of 200 characters.
3. The text wraps or is cut cleanly, the time label stays fully visible, and the checkbox, Edit and Delete buttons are all reachable with nothing overlapping.
4. Repeat with the dialog open and with the undo bar shown. Both fit in 320 px.

## Languages

1. For each of English, French, Portuguese, Spanish and Polish, switch the language in the picker.
2. The time label, its tooltip, the Clear all dialog, the undo bar and the cleared and restored messages are all translated, with no raw keys or "undefined".
3.  In Portuguese the label uses European Portuguese formats (pt-PT), for example a 24-hour time and "5 min". The tooltip date is numeric, as in "24/10/2026,
   00:33" (checked by the browser tests), not a month word.
4. Switching language updates existing labels immediately and does not clear the undo bar.

## Old local tasks (local mode only)

1. In dev tools, set `todo-items` in localStorage to tasks with no `createdAt`, using ids made like the app makes them
   (`Date.now().toString(36)` plus 4 characters, for example one from a few days ago).
2. Reload. Each task now shows a time. Check localStorage: `createdAt` has been added.
3. Add an id that is not in that format (for example `abc`). That task has no label and nothing breaks.

## Themes

1. Check everything above that is visual (time label, dialog, backdrop, undo bar, Clear all button, focus rings) in the light theme and in the dark theme.
2. Text and the time label stay readable (enough contrast), and the Cancel and confirm buttons look different from each other in both themes.
3. Toggle the theme while the dialog or undo bar is open. Nothing flickers or loses focus.

## Running the browser tests

Some of the checks above are now automated with Playwright, in `tests/e2e/`. The suite has its own `package.json`, so the app itself still has no
dependencies, and `npm test` does not run it (the files are named `*.spec.js`). It uses the installed Microsoft Edge, so no browser is downloaded.

    npm --prefix tests/e2e install
    npm run test:e2e
    npm run test:e2e:headed

The headed run opens a visible Edge window, runs one test at a time with each step slowed by 400 ms, and allows 120 s per test. It is the final check after a
change.

Each run starts a fresh server on port 3100 with a new temporary database, so a stale server can never be tested and the server on port 3000 and
`data/todo.db` are never touched. Port 3100 must be free.

The suite covers, in both local mode and account mode: the time label ("now", a valid `datetime`, the hidden "Added ..." text, and a reload), the Clear all
dialog (button hidden when empty, Cancel focused, Escape, Confirm, focus on Undo, Undo restoring order and times, Escape after an earlier Confirm), Clear
completed and Undo restoring original positions, Undo going away after another action, the 320 px layout, and the Portuguese labels and date format. In
account mode it also checks that a task error clears after the next successful action and that Undo is not offered when the server returns no undo token.

Still manual: themes and contrast, the Edit interactions, the other languages (French, Spanish, Polish), time labels older than an hour (minutes, clock time,
day and year), old local tasks without `createdAt`, the 15-minute undo window, and anything that needs a screen reader or touch.