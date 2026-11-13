Pocketbook for Codex, Gemini CLI and Copilot CLI: a todo list and a backlog that you can add to at any time.

## What it does

The lists are `.pocketbook/todo.md` and `.pocketbook/backlog.md` in the project, the same files the Claude Code plugin writes. `.pocketbook/` is added to `.gitignore` where there is a repository. Each item is a one-line summary with the full request under it.

Type these as a prompt:

| Prompt | What it does |
| --- | --- |
| `pb todo` | show the todo list, each item with its reference (`t1`, `t2` ...) |
| `pb todo -add <text>` | add an item |
| `pb backlog` | show the backlog, items as `b1`, `b2` ... |
| `pb remove t<n>` or `remove b<n>` | remove that todo or backlog item |
| `pb remove t -all` or `remove b -all` | empty the todo list or the backlog |
| `pb push t<n>` or `push -all` | put a todo item, or the whole todo list, on the backlog |
| `pb pop b<n>` or `pop -all` | bring a backlog item, or the whole backlog, back to the todo list |
| `pb edit t<n>` or `edit b<n> <new text>` | without text, show the item's whole request; with text, rewrite the item |
| `pb details t<n>` or `details b<n>` | show the whole request of that item |

Every command that changes the list answers with the list as it now stands. A hook answers these itself and does not send the prompt on, so they cost no tokens and still work when your usage is used up. Add as many as you like, including while a reply is running. A todo added while a reply is running is handed to the agent when that reply ends; if the reply never ends (usage ran out), your next prompt carries a note about it instead. A prompt that only starts with the letters `pb` goes through untouched: the next word has to be `todo`, `backlog`, `push`, `pop`, `details`, `edit` or `remove`.

The same commands are in `scripts/pocketbook.mjs` (`node scripts/pocketbook.mjs todo -add <text>`), which the included skill uses so the agent can read and change the lists when you ask it to.

## Setup per agent

- **Codex**: install, then open `/hooks` and trust the two Pocketbook hooks. Codex does not run hooks it has not been told to trust.
- **Gemini CLI**: `gemini extensions link plugins/pocketbook-portable` from a clone. Hooks are in `hooks/hooks.json`.
- **Copilot CLI**: installs the skill only. Its prompt hooks cannot block a prompt, so `pb` commands are not answered locally there; ask the agent to run them.

## Limits

- No footer meter, no soft or hard limit, no compaction: those need what only Claude Code lets a plugin do.
- It needs Node 18 or later on the PATH.
- Whether a prompt typed while a reply is running reaches the hook at once depends on the agent.
