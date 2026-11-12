Pocketbook: keeps a Claude Code conversation inside context limits picked from your own history, with a meter in the prompt footer, a soft limit that holds large tasks on a todo list, and compaction at a hard limit.

## What it does

- **Meter.** The footer shows `Context high 120K of 300K`: green with 70% or more of the limit left, yellow from 35% to 69%, red under 35%. It appears after the first reply of a new or just-compacted conversation.
- **Modes.** A button beside the meter names the mode. Press it to pick one of four; `[-]` goes back.

  | Mode | Soft limit | Hard limit |
  | --- | --- | --- |
  | `off` | nothing | nothing; the footer shows the size alone |
  | `lite` | note | never compacts |
  | `auto` (default) | note | compacts |
  | `ultra` | note, 50K earlier | compacts, at a limit worked out for the earlier start |

- **Soft limit.** Past it the status line says how much room is left, and Claude is told to start nothing needing more than a third of that room and to put larger requests on the todo list.
- **Hard limit.** The reply that passes it is followed by a compaction. If a background shell or agent is still running, the conversation is held instead and compacted when that work ends. While held, a typed prompt is not answered: it is added to the todo list and you are shown the list. `stop`, anything starting with `force:`, and `/pocketbook`, `/compact` and `/clear` still go through. `force:` is the way out if a shell is wrongly counted as running.
- **Todo list.** After a compaction or a `/clear`, the list is shown and Claude works through it, deleting each item as it is done.

Pocketbook turns Claude Code's own automatic compaction off, in every mode, so in `off` and `lite` nothing compacts unless you run `/compact`.

## Setup

`/pocketbook setup` reads the last 14 days of your transcripts (`/pocketbook setup 30` for 30) and shows, for each soft limit from 150K up in 50K steps, the share of tokens compacting there would have saved and the share of conversations that reached it. You pick the soft limit. The hard limit is then set where 80% of your conversations that passed the soft limit peaked. It needs `git` on the PATH, which it uses to read the transcripts. Until you run it, the limits are derived from your compaction window.

## Commands

| Command | What it does |
| --- | --- |
| `/pocketbook setup` | pick the limits from your history |
| `/pocketbook mode::<name>` | `off`, `lite`, `auto` or `ultra` |
| `/pocketbook todo` | show the todo list, each item with its number |
| `/pocketbook todo -add <text>` | add an item |
| `/pocketbook todo -remove <n>` | remove item n |
| `/pocketbook stash <n>` | move item n to the backlog |
| `/pocketbook archive` | move the whole todo list to the backlog |
| `/pocketbook backlog` | show the backlog |

The lists are `.pocketbook/todo.md` and `.pocketbook/backlog.md` in the project, and `.pocketbook/` is added to `.gitignore` where there is a repository. Each item is a one-line summary with the full request under it.

## Limits

- Claude judges a task's size itself from the room it is told is left; this is an instruction, not a guarantee.
- Background shells are counted from the calls that start them, so one that ends without a notification stays counted until the next prompt or `force:`.
- It does not remove Claude Code's own "Context low" warning.
- Claude Code only.

Install: `/plugin install pocketbook --marketplace <owner>/Pocketbook`
