# Pocketbook

Small plugins for the coding agents I use.

| Plugin | What it does | Works in |
| --- | --- | --- |
| [context-meter](plugins/context-meter) | Shows how much context is left, at the right of the prompt footer: `Context high (82% remaining)` in green at 70% or more, medium in yellow from 35% to 69%, low in red under 35%. | Claude Code |

## Install

```
/plugin marketplace add <owner>/Pocketbook
/plugin install context-meter@pocketbook
```

Or from a local clone: `/plugin marketplace add <path to this folder>`.

Only Claude Code has the footer this plugin draws into; other agents have no equivalent that a plugin can write to, so there is nothing to port yet.
