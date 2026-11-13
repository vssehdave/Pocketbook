---
name: pocketbook
description: "Keeps a todo list and a backlog for the project in .pocketbook/. Use when the user mentions their todo list or backlog, asks you to add, remove, stash or unstash an item, asks what is left to do, or when a request is too large to start in the room left and should wait on the list. Also use after finishing a request if the todo list has items."
---

# Pocketbook

The project's todo list is `.pocketbook/todo.md` and its backlog `.pocketbook/backlog.md`. Each item is a line `- one-line summary`, with the full request under it on lines indented by two spaces. The folder is kept out of git. Never edit the files by hand; use the script, which keeps the format.

`SCRIPT` below is `scripts/pocketbook.mjs` in the folder that holds this SKILL.md. Run it with Node from the project folder.

| To | Run |
| --- | --- |
| show the todo list | `node SCRIPT todo` |
| add an item | `node SCRIPT todo -add <the request, in full>` |
| remove item n (when it is done) | `node SCRIPT todo -remove <n>` |
| move item n to the backlog | `node SCRIPT stash <n>` |
| move the whole list to the backlog | `node SCRIPT stash -all` |
| show the backlog | `node SCRIPT backlog` |
| remove backlog item n | `node SCRIPT backlog -remove <n>` |
| empty the backlog | `node SCRIPT backlog -remove -all` |
| move backlog item n back to the todo list | `node SCRIPT unstash <n>` |
| move the whole backlog back | `node SCRIPT unstash -all` |
| rewrite an item (t for todo, b for backlog) | `node SCRIPT edit t<n> <new text>` |
| read the whole request of an item | `node SCRIPT details -todo <n>` or `details -backlog <n>` |

The user can also type `pb todo`, `pb todo -add <text>`, `pb todo -remove <n>`, `pb stash <n>`, `pb stash -all`, `pb backlog`, `pb unstash <n>`, `pb unstash -all` or `pb details -todo <n>` as a prompt. A hook answers those itself, so they reach you only if hooks are off; if one does, run the same command and show the answer.

## How to work with the list

- A request that is too big to finish in the room left: add it to the todo list, say that it is there and will be picked up after the conversation is compacted or restarted, and stop.
- When you finish a request and the todo list has items, say so and ask whether to continue, unless you were told to work through the list. When told to, take the items one at a time and remove each with `todo -remove` as soon as it is done.
- Items can be added while you are working. When a message says todo items were added while you worked, finish the current request first, then go through the list.
