import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Conf, Meter } from '../types'
import { K, band, ceilingOf, defaults, leftOf } from './lib'

const meter = atom({ plugin: 'pocketbook', key: 'meter' } as const, null as Meter)
const conf = atom({ plugin: 'pocketbook', key: 'conf' } as const, null as Conf | null)

// Reads the size after the engine has done its part, so the figure is the reply's, not the one before.
async function refresh($: any) {
  const { context } = await $.session.usage()
  await update($, meter, () => (context.tokens === undefined ? null : { tokens: context.tokens }))
}

// The limits are kept across sessions; the first session works them out from the window Claude Code itself measures against.
async function loadConf($: any) {
  let kept = (await $.store.get('conf')) as Conf | undefined

  if (kept === undefined) {
    const { context } = await $.session.usage({ breakdown: 'summary' }).catch(() => $.session.usage())
    kept = defaults(ceilingOf(context.window, context.breakdown))
    await $.store.set('conf', kept)
  }

  await update($, conf, () => kept)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await loadConf($)
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
    const limits = await read($, conf)

    if (m === null || limits === null) {
      return next(e)
    }

    const { name, color } = band(leftOf(m.tokens, limits.hard))
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box gap={1}>
        {await next(e)}
        <Text color={color}>
          Context {name} {K(m.tokens)} of {K(limits.hard)}
        </Text>
      </Box>
    )
  })
}
