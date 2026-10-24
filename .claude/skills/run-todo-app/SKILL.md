---
name: run-todo-app
description: Starts this TODO app with its built-in Node server in watch mode (npm run dev from the repo root) and gives the user http://localhost:3000 to open. Use when asked to run, start, serve, preview or open the TODO app.
---

# Run the TODO app locally

The app is plain HTML, CSS and JavaScript plus a small Node server (`server/`) that adds optional user accounts. The server uses only built-in Node modules, so
there is nothing to install and no build step.

## Steps

1. Check Node is 22.13 or newer:

   ```bash
   node --version
   ```

2. Check whether a server is already running on port 3000, for example from an earlier session. Node loads server code only at startup, so an old process
   keeps answering with the old API while the browser loads the new page files. If one is running and was not started with `npm run dev`, ask the user to stop
   it, or use another port.

3. From the repository root (the folder that contains `package.json`), start the server in the background in watch mode:

   ```bash
   npm run dev
   ```

   `node --watch` restarts the server whenever a file under `server/` changes, so it never serves stale code. Page files are re-read on every request and sent
   with `Cache-Control: no-cache`, so a normal reload picks them up. It listens on port 3000 by default. If that port is in use, set `PORT` (for example
   `PORT=3001 npm run dev`; in PowerShell, `$env:PORT=3001; npm run dev`) and use that port in the URL below.

4. Check that it started by reading the background output. It should print `TODO app running at http://localhost:3000`.

5. Tell the user to open http://localhost:3000 in their browser.

6. To stop the server, stop the background process (or press `Ctrl+C` if it runs in a terminal).

## Notes

- The page detects the server and switches to account mode: people create an account and sign in, and their tasks are stored on the server in `data/todo.db` (a
  SQLite file, not committed).
- In development, confirmation and password-reset emails are not sent. Their links are printed in the server output, so read the background output to find them.
- Without the server (opening `index.html` as a file, or any static server) the app runs in local mode: tasks, theme and language are kept in the browser's
  localStorage.
- `npm test` runs the Node tests. `npm run test:e2e` runs the browser tests headless; `npm run test:e2e:headed` runs them in a visible, slowed-down Edge window.
  Both start their own server on port 3100, so they never test the server on port 3000.
- Do not install packages or add a build step to run the app.
