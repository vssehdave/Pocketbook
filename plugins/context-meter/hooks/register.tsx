import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Meter } from '../types'

// The size the conversation is measured against: where it is compacted (CLAUDE_CODE_AUTO_COMPACT_WINDOW). shortcut: a constant, change it here if that changes.
const WINDOW = 300_000

const meter = atom({ plugin: 'context-meter', key: 'meter' } as const, null as Meter)

// Bands of what is left: 70% or more is high, 35 to 69 medium, under 35 low.
const band = (left: number) =>
  left >= 70
    ? { name: 'high', color: 'green' }
    : left >= 35
      ? { name: 'medium', color: 'yellow' }
      : { name: 'low', color: 'red' }

// Reads the size after the engine has done its part, so the figure is the reply's, not the one before.
async function refresh($: any) {
  const { context } = await $.session.usage()
  await update($, meter, () => (context.tokens === undefined ? null : { tokens: context.tokens }))
}

export const register: Register = on => {

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const m = await read($, meter)

    if (m === null) {
      return next(e)
    }

    const left = Math.max(0, Math.round(100 - (m.tokens / WINDOW) * 100))
    const { name, color } = band(left)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box gap={1}>
        {await next(e)}
        <Text color={color}>
          Context {name} ({left}% remaining)
        </Text>
      </Box>
    )
  })
}
