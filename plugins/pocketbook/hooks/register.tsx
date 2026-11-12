import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Conf, Meter, Mode } from '../types'
import { K, MODES, band, ceilingOf, defaults, isMode, leftOf, limitsOf } from './lib'

const meter = atom({ plugin: 'pocketbook', key: 'meter' } as const, null as Meter)
const conf = atom({ plugin: 'pocketbook', key: 'conf' } as const, null as Conf | null)
const mode = atom({ plugin: 'pocketbook', key: 'mode' } as const, 'auto' as Mode)
// Whether the footer shows the four modes to pick from, in place of the meter.
const isModesOpen = atom({ plugin: 'pocketbook', key: 'isModesOpen' } as const, false)

// The mode is the person's choice, kept across sessions.
async function setMode($: any, picked: Mode) {
  await $.store.set('mode', picked)
  await update($, mode, () => picked)
}

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

  const picked = await $.store.get('mode')
  await update($, mode, () => (isMode(picked) ? picked : 'auto'))
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

    if (limits === null) {
      return next(e)
    }

    const current = await read($, mode)
    const { shown } = limitsOf(limits, current)
    const { name, color } = band(leftOf(m?.tokens ?? 0, shown))
    const { Box, Button, Text } = $.ui.resolve(e)

    if (await read($, isModesOpen)) {
      return (
        <Box gap={1}>
          {await next(e)}
          {MODES.map(one => (
            <Button key={`mode:${one}`} plain onPress={() => setMode($, one)}>
              {one === current ? <Text>{`[ ${one} ]`}</Text> : <Text dimColor>{one}</Text>}
            </Button>
          ))}
          <Button key="close" plain onPress={() => update($, isModesOpen, () => false)}>
            <Text dimColor>[-]</Text>
          </Button>
        </Box>
      )
    }

    // Off measures nothing against a limit, so it gives the size alone; the meter waits for the first reply either way.
    const size =
      m === null ? null : current === 'off' ? (
        <Text>
          ~{K(m.tokens)} tokens of {K(shown)} tokens
        </Text>
      ) : (
        <Text color={color}>
          Context {name} {K(m.tokens)} of {K(shown)}
        </Text>
      )

    return (
      <Box gap={1}>
        {await next(e)}
        {size}
        <Button key="mode" plain onPress={() => update($, isModesOpen, () => true)}>
          <Text color={color}>●</Text> <Text>{current}</Text>
        </Button>
      </Box>
    )
  })
}
