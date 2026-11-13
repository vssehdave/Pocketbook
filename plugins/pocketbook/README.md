Pocketbook: keeps a Claude Code conversation inside context limits picked from your own history, with a meter in the prompt footer, a soft limit that holds large tasks on a todo list, and compaction at a hard limit.

## What it does

- **Meter.** The footer shows `Context high (120K used of 300K)`: green with 70% or more of the limit left, muted yellow from 35% to 69%, muted red under 35%. `/pocketbook setup -units` switches it to `Context high (40% used)`. It appears after the first reply of a new or just-compacted conversation.
- **Modes.** A button beside the meter names the mode. Press it to pick one of four; `[-]` goes back. The chosen mode is drawn in the meter's colour: `off` always light grey, `lite` a lighter shade, `auto` the meter's own, `ultra` a darker one (olive, dark gold, crimson).

  | Mode | Soft limit | Hard limit |
  | --- | --- | --- |
  | `off` | nothing | nothing; the footer shows the size alone |
  | `lite` | note | never compacts |
  | `auto` (default) | note | compacts |
  | `ultra` | note, 50K earlier | compacts, at a limit worked out for the earlier start |

- **Soft limit.** Past it the status line says how much room is left, and Claude is told to start nothing needing more than a third of that room and to put larger requests on the todo list.
- **Hard limit.** The reply that passes it is followed by a compaction. If a background shell or agent is still running, the conversation is held instead and compacted when that work ends. While held, a typed prompt is not answered: it is added to the todo list and you are told why. `stop`, anything starting with `force:`, and `/pocketbook`, `/compact` and `/clear` still go through. `force:` is the way out if a shell is wrongly counted as running.
- **Todo list.** After Pocketbook's own compaction, Claude works through it first in, first out, deleting each item as it is done. After a `/clear` or a compaction you or Claude Code made, nothing starts: you are told how many items are waiting, and `/pocketbook work` starts the run. In `off` mode nothing starts on its own: no run after a compaction, no hand-back of items added during a reply. `/pocketbook work` still goes ahead when you ask.

- **When your usage runs out.** At 95% of a rate-limit window a message says once that `/pocketbook todo -add` keeps working after the limit is hit: it is a local command, so it needs no model, and the summary becomes the request's first 60 characters followed by `...`, with anything shaped like an email address or a key blanked. The whole request is kept under the summary in the list file. Add as many as you like, mid-reply or after the limit. A todo added while a reply is running is handed to Claude when that reply ends; if usage is out by then, it is carried by your next prompt instead.

Pocketbook turns Claude Code's own automatic compaction off, in every mode, so in `off` and `lite` nothing compacts unless you run `/compact`.

## Setup

`/pocketbook setup` reads the last 14 days of your transcripts (`/pocketbook setup 30` for 30) and shows, for each soft limit from 150K up in 50K steps, the share of tokens compacting there would have saved and the share of conversations that reached it. You pick the soft limit. The hard limit is then set where 80% of your conversations that passed the soft limit peaked. It needs `git` on the PATH, which it uses to read the transcripts. Until you run it, the limits are derived from your compaction window. If `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is set and Claude Code's own auto-compact is off, setup also says that Claude Code will draw its red "Context low" warning from about 80% of that window, and where to remove it.

## Commands

| Command | What it does |
| --- | --- |
| `/pocketbook setup` | pick the limits from your history |
| `/pocketbook setup -units [tokens\|%]` | switch the footer between tokens and percent used (no word toggles) |
| `/pocketbook mode::<name>` | `off`, `lite`, `auto` or `ultra`. It answers with where that mode notes and compacts; picking `off` instead says how many compactions Pocketbook has made so far and how many tokens they shrank the context by in total (the context before each, less after it). The footer's mode buttons print the same answer in the transcript. |
| `/pocketbook todo` | show the todo list alone, each item with its number |
| `/pocketbook todo -add <text>` | add an item |
| `/pocketbook todo -remove <n>` | remove item n |
| `/pocketbook stash <n>` | move item n to the backlog |
| `/pocketbook stash -all` | move the whole todo list to the backlog |
| `/pocketbook backlog` | show the backlog alone |
| `/pocketbook backlog -add <text>` | add an item to the backlog |
| `/pocketbook backlog -remove <n>` | remove backlog item n |
| `/pocketbook backlog -remove -all` (also `todo -remove -all`) | empty that list |
| `/pocketbook unstash <n>` | move backlog item n back to the todo list |
| `/pocketbook work` or `work <n>` | start a run: the model is handed the first item on the todo list, and when its reply ends the next first item, until the list is empty. Items removed meanwhile are skipped and the numbers are read again each time. A reply that leaves the first item as it was stops the run (so a stuck item is not repeated); `work` picks it up again. `work <n>` hands over just item n. Past the soft limit it compacts first, and the list is handed over after. Refused when usage is used up. The model is told to read each item's full request in the file, since the list shows only summaries |
| `/pocketbook unstash -all` | move the whole backlog back to the todo list |
| `/pocketbook details -todo <n>` or `-backlog <n>` | open the pane on the whole request of that item, under the title `TODO #n` or `BACKLOG #n`; `[back]` returns to the lists. It reads the list file and calls no model, so it works when usage has run out |

The footer's `show` button opens one pane with the todo list on the top half and the backlog on the bottom half. `/pocketbook todo` and `/pocketbook backlog` open their own list alone, using the whole pane. Each list has a title between dashes that fill the width, then its summaries from the left with their numbers at the right edge, on the item's first line, a long summary wrapping under itself. Click a number to open that item's whole request under the title `TODO #n` or `BACKLOG #n`, with `[back]` at the left of the title. The pane only ever opens when you press or type something, never by itself. The ✕ in its corner or Escape closes it, and it follows the lists as you change them. A list with more items than it has room for (a pane above the prompt is about a third of the terminal's height) is paged with `[▲]` and `[▼]` at the right of its title. A toast was tried first and cannot work: the engine shows at most three lines of one and turns every line break into a replacement character. None of the commands calls the model. The lists are `.pocketbook/todo.md` and `.pocketbook/backlog.md` in the project, and `.pocketbook/` is put in `.gitignore` before either list is written. The `.gitignore` is created if there is none, in a repository or not, and a list is not written if that cannot be done. A folder whose lists already exist is covered at the start of a session. Each item is a one-line summary with the full request under it.

## Limits

- Claude judges a task's size itself from the room it is told is left; this is an instruction, not a guarantee.
- Background shells are counted from the calls that start them, so one that ends without a notification stays counted until the next prompt or `force:`.
- It cannot hide Claude Code's own red "Context low" warning: Claude Code raises it in a notification bar that plugins cannot reach. It shows only when auto-compact is off, measured against `CLAUDE_CODE_AUTO_COMPACT_WINDOW` if that is set; `/pocketbook setup` says so when it applies.
- Claude Code only.

Install: `/plugin marketplace add vssehdave/Pocketbook`, then `/plugin install pocketbook@pocketbook`.
