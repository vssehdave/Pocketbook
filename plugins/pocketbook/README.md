Pocketbook: shows how much of your conversation's context is left, at the right of Claude Code's prompt footer, in colour.

It reads the size of the conversation after every model step and draws `Context high (82% remaining)` in green at 70% or more, `Context medium (50% remaining)` in yellow from 35% to 69%, and `Context low (20% remaining)` in red under 35%. The percentage is measured against the size at which Claude Code compacts the conversation, 300k tokens (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=300k`); change `WINDOW` at the top of `hooks/register.tsx` if yours differs. The meter stays hidden until the first reply of a new or just-compacted conversation, because Claude Code has no figure before then.

It does not remove Claude Code's own "Context low" warning, which the mod interface gives no way to hide, and it works in Claude Code only.

Install: `/plugin install pocketbook --marketplace <owner>/Pocketbook`
