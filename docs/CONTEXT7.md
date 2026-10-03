# Using the Context7 MCP server

[Context7](https://context7.com/) gives Claude Code up-to-date documentation and code examples for libraries and web platform APIs, so answers are based on current docs rather than on what the model remembers.

## Setup

Context7 is a hosted MCP server, so there is nothing to install:

```bash
claude mcp add --transport http context7 https://mcp.context7.com/mcp
claude mcp get context7      # should show: Status: √ Connected
```

Add `--scope user` to make it available in every project. Optional: add `--header "CONTEXT7_API_KEY: <your-key>"` (free key from context7.com) for higher rate limits.

After adding it, start a new Claude Code session (or run `/mcp`) so the tools load.

## The two tools

Context7 has two tools, and they are normally used together:

| Tool | Input | What it does |
| --- | --- | --- |
| `resolve-library-id` | `libraryName`, `query` | Finds the library and returns its Context7 ID, such as `/microsoft/playwright`. |
| `query-docs` | `libraryId`, `query` | Returns docs and code snippets for one topic from that library. |

The flow is: **resolve the ID → query the docs → answer**. If you already know the ID, you can skip the first step.

You don't call these tools yourself. You ask Claude Code in plain words and it calls them. Adding **"use context7"** to a prompt makes sure it does.

## Picking the right library

`resolve-library-id` often returns several matches. For example, searching for **Playwright** returns:

| Library ID | Code snippets | Reputation | Benchmark |
| --- | --- | --- | --- |
| `/microsoft/playwright` | 8,257 | High | 83.41 |
| `/websites/playwright_dev` | 4,651 | High | 87.24 |
| `/microsoft/playwright.dev` | 450 | High | 58.68 |
| `/websites/playwright_dev_dotnet` | 3,558 | High | ... |

To choose:

- **Name and language:** pick the one that matches what you use. `playwright_dev_dotnet` is for .NET, not JavaScript.
- **Code snippets:** more snippets usually means better coverage.
- **Source reputation:** prefer High.
- **Benchmark score:** higher is better (100 is the maximum).
- **Version:** some libraries list versions (Playwright: `v1.51.0`, `v1.58.2`, `v1.61.0`, `v1.63.0`). Use `/org/project/version`, for example `/microsoft/playwright/v1.63.0`, to match the version in your `package.json`.

Useful IDs for this project (checked against Context7):

| What | Library ID |
| --- | --- |
| HTML, CSS, JavaScript and Web APIs (MDN) | `/mdn/content` |
| Playwright (browser testing) | `/microsoft/playwright` |
| Vite (dev server and build tool) | `/vitejs/vite` |

## Example prompts

### 1. Look up a Web API this app uses

> How should I handle errors from localStorage.setItem, for example when storage is full? use context7

Claude Code resolves **MDN Web Docs** to `/mdn/content`, then queries something like *"localStorage setItem QuotaExceededError handling"*. Relevant to `save()` in `app.js`.

### 2. Give the library ID directly (skips the resolve step)

> use library /mdn/content for docs on matchMedia and listening for prefers-color-scheme changes

Useful when you already know the ID. Relevant to `detectTheme()`: the app could follow OS theme changes while it's open.

### 3. Pin a version

> Using /microsoft/playwright/v1.63.0, show me how to write a test that adds a task and checks it appears in the list

Pinning a version stops the answer from using APIs newer or older than the one you have installed.

### 4. Plan a new feature using current docs

> I want to add end-to-end tests to this TODO app with Playwright. Use context7 to check the current setup steps, then write a test for adding, completing and deleting a task.

Claude Code resolves Playwright, queries its setup and its locator/assertion docs, then writes the test against this repo's HTML (`#todo-input`, `#todo-list`, and so on).

### 5. Compare options

> Should I serve this app with Vite or just a static server? use context7 to check what Vite's dev server gives a plain HTML/JS project.

### 6. Translation and plural rules

> use context7 to look up Intl.PluralRules on MDN, and tell me if I could use it to replace the itemsLeft functions in i18n.js

## Writing good queries

`query-docs` works best with **one specific topic per question**.

| Good | Too vague | Too broad |
| --- | --- | --- |
| "Playwright: assert a list has N items" | "testing" | "Playwright setup, locators, CI and screenshots" |
| "localStorage QuotaExceededError handling" | "storage" | "all of the Web Storage API" |

If a question covers several topics, Claude Code should make one call per topic. Each tool is limited to about 3 calls per question, so specific prompts get better results.

Don't put secrets, API keys, personal data or private code in prompts that use Context7. The query text is sent to the Context7 API.

## Other tools

Context7 is one source among several. Claude Code chooses among them, but you can ask for one by name:

| Need | Tool |
| --- | --- |
| Library or Web API docs | **Context7** (`resolve-library-id`, `query-docs`) |
| A specific web page, such as a changelog or GitHub issue | Built-in **WebFetch** ("fetch https://... and summarize") |
| News, blog posts, or things not in docs | Built-in **WebSearch** |
| This repo's own code | Built-in **Read**, **Grep** and **Glob** ("how does render() work?") |
| GitHub PRs and issues | The **`gh`** CLI ("create a PR", "list open issues") |

The design plugin's MCP servers (Figma, Linear, Notion, Slack, Atlassian, Intercom) are also configured. They need to be authorized with `/mcp` before they work.

Check what's connected at any time:

```bash
claude mcp list
```

Inside a Claude Code session, run `/mcp` to see each server's status and tools.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `claude: command not found` | Open a new terminal. The CLI lives in `%USERPROFILE%\.local\bin`, which must be on PATH. |
| `context7` shows as failed or "Connection closed" in a session | Run `claude mcp get context7` to check it's reachable, then start a new session or reconnect it from `/mcp`. |
| Rate-limit errors | Add a free API key with `--header "CONTEXT7_API_KEY: <key>"`. |
| Wrong library picked | Give the ID directly, for example `use library /mdn/content`. |
| Remove it | `claude mcp remove context7 -s local` |
