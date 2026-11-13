Pocketbook for Codex, Gemini CLI and Copilot CLI: a bookmark list and a shelf that you can add to at any time.

## What it does

The lists are `.pocketbook/bookmark.md` and `.pocketbook/shelf.md` in the project, the same files the Claude Code plugin writes. `.pocketbook/` is added to `.gitignore` where there is a repository. Each item is a one-line summary with the full request under it.

Type these as a prompt:

| Prompt | What it does |
| --- | --- |
| `pb bookmark` | show the bookmark list, each item with its reference (`b1`, `b2` ...) |
| `pb bookmark -add <text>` | add an item |
| `pb shelf` | show the shelf, items as `s1`, `s2` ... |
| `pb remove b<n>` or `remove s<n>` | remove that bookmark or shelf item |
| `pb remove b -all` or `remove s -all` | empty the bookmark list or the shelf |
| `pb push b<n>` or `push -all` | put a bookmark item, or the whole bookmark list, on the shelf |
| `pb pop s<n>` or `pop -all` | bring a shelf item, or the whole shelf, back to the bookmark list |
| `pb edit b<n>` or `edit s<n> <new text>` | without text, show the item's whole request; with text, rewrite the item |
| `pb details b<n>` or `details s<n>` | show the whole request of that item |

Every command that changes the list answers with the list as it now stands. A hook answers these itself and does not send the prompt on, so they cost no tokens and still work when your usage is used up. Add as many as you like, including while a reply is running. A bookmark added while a reply is running is handed to the agent when that reply ends; if the reply never ends (usage ran out), your next prompt carries a note about it instead. A prompt that only starts with the letters `pb` goes through untouched: the next word has to be `bookmark`, `shelf`, `push`, `pop`, `details`, `edit` or `remove`.

The same commands are in `scripts/pocketbook.mjs` (`node scripts/pocketbook.mjs bookmark -add <text>`), which the included skill uses so the agent can read and change the lists when you ask it to.

## Setup per agent

- **Codex**: install, then open `/hooks` and trust the two Pocketbook hooks. Codex does not run hooks it has not been told to trust.
- **Gemini CLI**: `gemini extensions link plugins/pocketbook-portable` from a clone. Hooks are in `hooks/hooks.json`.
- **Copilot CLI**: installs the skill only. Its prompt hooks cannot block a prompt, so `pb` commands are not answered locally there; ask the agent to run them.

Lists kept under their old names, `.pocketbook/todo.md` and `.pocketbook/backlog.md`, are still read until the first change writes them as `bookmark.md` and `shelf.md`. The old `todo` and `backlog` commands are gone.

## Limits

- No footer meter, no soft or hard limit, no compaction: those need what only Claude Code lets a plugin do.
- It needs Node 18 or later on the PATH.
- Whether a prompt typed while a reply is running reaches the hook at once depends on the agent.
