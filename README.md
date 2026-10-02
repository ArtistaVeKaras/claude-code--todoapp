# TODO App

A simple TODO web app built with plain HTML, CSS and JavaScript. There is nothing to install and no build step: clone the repo and open it in a browser.

## Features

- Add, complete and delete tasks
- Filter by All, Active or Completed, and clear completed tasks
- Dark and light theme toggle (🌙 / ☀️ button)
- Language switcher: English, French and Portuguese
- Tasks, theme and language are saved in your browser (localStorage), so they are still there after a reload

## Project structure

```
index.html   Page layout
styles.css   Styles for the light and dark themes
i18n.js      Translations (English, French, Portuguese)
app.js       App logic
```

## Run it from a terminal

Clone the repository:

```bash
git clone https://github.com/ArtistaVeKaras/claude-code--todoapp.git
cd claude-code--todoapp
```

**Option 1: open the file directly**

```bash
# macOS
open index.html
# Linux
xdg-open index.html
# Windows (PowerShell or cmd)
start index.html
```

**Option 2: run a small local server** (any one of these works)

```bash
python3 -m http.server 8000
# or, if you have Node.js
npx serve .
```

Then open http://localhost:8000 (or the address `npx serve` prints) in your browser. Press `Ctrl+C` in the terminal to stop the server.

## Run it from Claude Code

Start Claude Code in the project folder:

```bash
cd claude-code--todoapp
claude
```

Then ask it in plain words, for example:

> Start a local server for this app and give me the URL

Claude Code will start a server such as `python3 -m http.server 8000` in the background, and you can open http://localhost:8000 in your browser. You can also just ask it to "open index.html in my browser".

## Adding a language

1. Open `i18n.js`, copy the `en` block and translate each value.
2. Add a matching `<option>` to the language select in `index.html`.
