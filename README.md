# Pocketbook

A footer meter, context limits picked from your own history, and a todo list that keeps working when a conversation or your usage runs out.

| Plugin | What it does | Works in |
| --- | --- | --- |
| [pocketbook](plugins/pocketbook) | The whole thing: a footer meter (`Context high (120K used of 300K)`), four modes, a soft limit that holds large tasks on a todo list, compaction at a hard limit, and a todo list that still takes `-add` once your usage is used up. | Claude Code |
| [pocketbook-portable](plugins/pocketbook-portable) | The todo list and backlog: `pb todo -add <text>` any time, answered without the model, and picked up when the current reply ends. | Codex, Gemini CLI, Copilot CLI |

## Install

Both are in the `library` marketplace.

**Claude Code**

```
/plugin marketplace add vssehdave/library
/plugin install pocketbook@library
```

Then run `/pocketbook setup` once to pick your limits.

**Codex**

```
codex plugin marketplace add vssehdave/library
codex plugin add pocketbook@library
```

Open `/hooks` in Codex and trust the two Pocketbook hooks; Codex skips hooks it has not been told to trust.

**Copilot CLI**

```
copilot plugin marketplace add vssehdave/library
copilot plugin install pocketbook@library
```

**Gemini CLI**: from a clone of this repository,

```
gemini extensions link plugins/pocketbook-portable
```

From a local clone, any marketplace command above also takes the path of this folder in place of `vssehdave/library`, and the plugin is then `pocketbook@pocketbook`.

## What each agent gets

|  | Claude Code | Codex | Gemini CLI | Copilot CLI |
| --- | --- | --- | --- | --- |
| Footer meter, modes, soft and hard limits | yes | no | no | no |
| Todo list and backlog | `/pocketbook todo ...` | `pb todo ...` | `pb todo ...` | skill only |
| Answered without the model (works with usage used up) | yes | yes | yes | no |
| Items added mid-reply are handed back when it ends | yes | yes | yes | no |

Only Claude Code lets a plugin draw in the footer, read the context size and compact the conversation. The other agents show their own context figure, and a plugin cannot change it. Copilot CLI's prompt hooks cannot block or answer a prompt, so there the todo list is a skill the model runs.

## Development

```
claude plugin validate plugins/pocketbook
claude plugin test plugins/pocketbook
node --test plugins/pocketbook-portable/scripts/pocketbook.test.mjs
```
