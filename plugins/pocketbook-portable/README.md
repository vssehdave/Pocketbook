Pocketbook for Codex, Gemini CLI and Copilot CLI: a todo list and a backlog that you can add to at any time.

## What it does

The lists are `.pocketbook/todo.md` and `.pocketbook/backlog.md` in the project, the same files the Claude Code plugin writes. `.pocketbook/` is added to `.gitignore` where there is a repository. Each item is a one-line summary with the full request under it.

Type these as a prompt:

| Prompt | What it does |
| --- | --- |
| `pb todo` | show the todo list, each item with its number |
| `pb todo -add <text>` | add an item |
| `pb todo -remove <n>` | remove item n |
| `pb stash <n>` | move item n to the backlog |
| `pb stash -all` | move the whole todo list to the backlog |
| `pb backlog` | show the backlog |
| `pb backlog -remove <n>` | remove backlog item n |
| `pb backlog -remove -all` | empty the backlog |
| `pb unstash <n>` | move backlog item n back to the todo list |
| `pb unstash -all` | move the whole backlog back to the todo list |
| `pb edit t<n>` or `edit b<n> <new text>` | without text, show the item's whole request; with text, rewrite the item |
| `pb details -todo <n>` or `-backlog <n>` | show the whole request of that item |

Every command that changes the list answers with the list as it now stands. A hook answers these itself and does not send the prompt on, so they cost no tokens and still work when your usage is used up. Add as many as you like, including while a reply is running. A todo added while a reply is running is handed to the agent when that reply ends; if the reply never ends (usage ran out), your next prompt carries a note about it instead. A prompt that only starts with the letters `pb` goes through untouched: the next word has to be `todo`, `stash`, `backlog`, `unstash`, `details` or `edit`.

The same commands are in `scripts/pocketbook.mjs` (`node scripts/pocketbook.mjs todo -add <text>`), which the included skill uses so the agent can read and change the lists when you ask it to.

## Setup per agent

- **Codex**: install, then open `/hooks` and trust the two Pocketbook hooks. Codex does not run hooks it has not been told to trust.
- **Gemini CLI**: `gemini extensions link plugins/pocketbook-portable` from a clone. Hooks are in `hooks/hooks.json`.
- **Copilot CLI**: installs the skill only. Its prompt hooks cannot block a prompt, so `pb` commands are not answered locally there; ask the agent to run them.

## Limits

- No footer meter, no soft or hard limit, no compaction: those need what only Claude Code lets a plugin do.
- It needs Node 18 or later on the PATH.
- Whether a prompt typed while a reply is running reaches the hook at once depends on the agent.
