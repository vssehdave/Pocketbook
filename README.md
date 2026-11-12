# Pocketbook

Small plugins for the coding agents I use.

| Plugin | What it does | Works in |
| --- | --- | --- |
| [pocketbook](plugins/pocketbook) | Keeps a conversation inside context limits picked from your own history: a footer meter (`Context high 120K of 300K`), four modes, a soft limit that holds large tasks on a todo list, and compaction at a hard limit. | Claude Code |

## Install

```
/plugin marketplace add <owner>/Pocketbook
/plugin install pocketbook@pocketbook
```

Or from a local clone: `/plugin marketplace add <path to this folder>`.

Then run `/pocketbook setup` once to pick your limits.

Only Claude Code has the footer and the hooks this plugin uses; other agents have no equivalent that a plugin can reach, so there is nothing to port yet.

## Development

```
claude plugin validate plugins/pocketbook
claude plugin test plugins/pocketbook
```
