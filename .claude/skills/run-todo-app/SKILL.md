---
name: run-todo-app
description: Starts this TODO app on a local web server (python3 -m http.server 8000 from the repo root) and gives the user http://localhost:8000 to open. Use when asked to run, start, serve, preview or open the TODO app.
---

# Run the TODO app locally

This app is plain HTML, CSS and JavaScript with no build step and no dependencies, so running it only means serving the repository folder over HTTP.

## Steps

1. From the repository root (the folder that contains `index.html`), start the server in the background:

   ```bash
   python3 -m http.server 8000
   ```

   If port 8000 is already in use, use another port such as `8001` and use that port in the URL below.

2. Check that it responds:

   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/
   ```

   Expect `200`.

3. Tell the user to open http://localhost:8000 in their browser.

4. To stop the server, stop the background process (or press `Ctrl+C` if it runs in a terminal).

## Notes

- Tasks, theme and language are kept in the browser's localStorage, so there is no database or backend to start.
- If Python is not available, `npx serve .` works too, or open `index.html` directly in a browser.
- Do not install packages or add a build step to run the app.
