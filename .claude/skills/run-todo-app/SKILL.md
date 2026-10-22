---
name: run-todo-app
description: Starts this TODO app with its built-in Node server (npm start from the repo root) and gives the user http://localhost:3000 to open. Use when asked to run, start, serve, preview or open the TODO app.
---

# Run the TODO app locally

The app is plain HTML, CSS and JavaScript plus a small Node server (`server/`) that adds optional user accounts. The server uses only built-in Node modules, so
there is nothing to install and no build step.

## Steps

1. Check Node is 22.13 or newer:

   ```bash
   node --version
   ```

2. From the repository root (the folder that contains `package.json`), start the server in the background:

   ```bash
   npm start
   ```

   It listens on port 3000 by default. If that port is in use, set `PORT` (for example `PORT=3001 npm start`; in PowerShell, `$env:PORT=3001; npm start`) and
   use that port in the URL below.

3. Check that it started by reading the background output. It should print `TODO app running at http://localhost:3000`. If `curl` is allowed in this session,
   `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/` should print `200`.

4. Tell the user to open http://localhost:3000 in their browser.

5. To stop the server, stop the background process (or press `Ctrl+C` if it runs in a terminal).

## Notes

- The page detects the server and switches to account mode: people create an account and sign in, and their tasks are stored on the server in `data/todo.db` (a
  SQLite file, not committed).
- In development, confirmation and password-reset emails are not sent. Their links are printed in the server output, so read the background output to find them.
- Without the server (opening `index.html` as a file, or any static server) the app runs in local mode: tasks, theme and language are kept in the browser's
  localStorage.
- `npm test` runs the automated tests with Node's built-in test runner.
- Do not install packages or add a build step to run the app.
