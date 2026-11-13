---
name: pocketbook
description: "Keeps a bookmark list and a shelf for the project in .pocketbook/. Use when the user mentions their bookmark list or shelf, asks you to add, remove, push or pop an item, asks what is left to do, or when a request is too large to start in the room left and should wait on the list. Also use after finishing a request if the bookmark list has items."
---

# Pocketbook

The project's bookmark list is `.pocketbook/bookmark.md` and its shelf `.pocketbook/shelf.md`. Each item is a line `- one-line summary`, with the full request under it on lines indented by two spaces. The folder is kept out of git. Never edit the files by hand; use the script, which keeps the format.

`SCRIPT` below is `scripts/pocketbook.mjs` in the folder that holds this SKILL.md. Run it with Node from the project folder.

| To | Run |
| --- | --- |
| show the bookmark list | `node SCRIPT bookmark` |
| add an item | `node SCRIPT bookmark -add <the request, in full>` |
| remove an item (when it is done) | `node SCRIPT remove b<n>` (`s<n>` for the shelf) |
| empty a list | `node SCRIPT remove b -all` or `remove s -all` |
| put bookmark item n on the shelf | `node SCRIPT push b<n>`, or `push -all` for the whole list |
| bring shelf item n back | `node SCRIPT pop s<n>`, or `pop -all` for the whole shelf |
| show the shelf | `node SCRIPT shelf` |
| rewrite an item | `node SCRIPT edit b<n> <new text>` |
| read the whole request of an item | `node SCRIPT details b<n>` or `details s<n>` |

Items are named by their list and place: `b3` is the third bookmark item, `s2` the second shelf item, as the lists show them.

The user can also type any of these with `pb` in front, such as `pb bookmark -add <text>`, `pb push b<n>` or `pb remove s<n>` as a prompt. A hook answers those itself, so they reach you only if hooks are off; if one does, run the same command and show the answer.

## How to work with the list

- A request that is too big to finish in the room left: add it to the bookmark list, say that it is there and will be picked up after the conversation is compacted or restarted, and stop.
- When you finish a request and the bookmark list has items, say so and ask whether to continue, unless you were told to work through the list. When told to, take the items one at a time and remove each with `remove b<n>` as soon as it is done.
- Items can be added while you are working. When a message says bookmark items were added while you worked, finish the current request first, then go through the list.
