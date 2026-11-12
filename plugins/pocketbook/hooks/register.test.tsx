import { expect, test } from 'claude-code/testing'

const SLOT = { plugin: 'pocketbook', component: 'SessionMode', surface: 'terminal', props: { modes: [] as string[] } } as const
const CONF = { ceiling: 300_000, soft: 225_000, hard: 300_000, ultraSoft: 175_000, ultraHard: 250_000, isSetUp: false }

// What the session had stored, by key: the last context size and the limits.
const stored = (state: Record<string, unknown>) => (_: unknown, e: { key: string }) => ({ value: { value: state[e.key], version: 1 } })

const cases = [
  { tokens: 60_000, text: 'Context high (60K used of 300K)' },
  { tokens: 93_000, text: 'Context medium (93K used of 300K)' }, // just under 70% left
  { tokens: 198_000, text: 'Context low (198K used of 300K)' }, // just under 35% left
  { tokens: 450_000, text: 'Context low (450K used of 300K)' }, // past the limit
]

for (const c of cases) {
  test(`${c.tokens} tokens reads "${c.text}"`, async ($, on) => {
    on('state.get', stored({ meter: { tokens: c.tokens }, conf: CONF }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>focus</Text> // what the engine draws in the slot
    })
    const ui = await $.ui.mount(SLOT)

    expect((await ui.find({ type: 'Text', text: /Context/ }))?.text).toBe(c.text)
    expect((await ui.find({ type: 'Text', text: /focus/ }))?.text).toBe('focus') // and it is kept
    await ui.unmount()
  })
}

test('nothing is drawn before the first reply, and the engine draws the footer', async ($, on) => {
  on('state.get', stored({ meter: null, conf: CONF }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(SLOT)

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
  await ui.unmount()
})

test('off mode gives the size alone', async ($, on) => {
  on('state.get', stored({ meter: { tokens: 120_000 }, conf: CONF, mode: 'off' }))
  const ui = await $.ui.mount(SLOT)

  expect((await ui.find({ type: 'Text', text: /tokens/ }))?.text).toBe('~120K tokens of 300K tokens')
  await ui.unmount()
})

test('percent units give the share used', async ($, on) => {
  on('state.get', stored({ meter: { tokens: 75_000 }, conf: CONF, units: 'percent' }))
  const ui = await $.ui.mount(SLOT)

  expect((await ui.find({ type: 'Text', text: /Context/ }))?.text).toBe('Context high (25% used)')
  await ui.unmount()
})

test('percent units in off mode', async ($, on) => {
  on('state.get', stored({ meter: { tokens: 75_000 }, conf: CONF, units: 'percent', mode: 'off' }))
  const ui = await $.ui.mount(SLOT)

  expect((await ui.find({ type: 'Text', text: /used/ }))?.text).toBe('~25% used')
  await ui.unmount()
})

// The chosen mode, as the opened mode list shows it, with the session at `tokens`.
const chosen = async ($: any, on: any, mode: string, tokens: number) => {
  const kept: Record<string, unknown> = { conf: CONF, mode }
  on('store.get', (_: unknown, e: { key: string }) => ({ value: kept[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, tokens } } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pocketbook' } }))
  on('ui.status', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(SLOT)
  await ui.press({ key: 'mode' })
  const color = (await ui.find({ type: 'Text', text: new RegExp(`^[[] ${mode} `) }))?.props.color
  await ui.unmount()

  return color
}

// Off is grey; lite, auto and ultra are the light, own and dark shade of the footer's colour.
const shades = [
  ['off', 60_000, '#bdbdbd'],
  ['lite', 60_000, '#a8dba8'],
  ['auto', 60_000, 'green'],
  ['ultra', 60_000, '#6b8e23'],
  ['lite', 93_000, '#e6d28f'],
  ['auto', 93_000, '#cfae4f'],
  ['ultra', 93_000, '#b8860b'],
  ['lite', 240_000, '#e5a3a0'],
  ['auto', 240_000, '#cc6a64'],
  ['ultra', 240_000, '#9b1b30'],
] as const

for (const [mode, tokens, color] of shades) {
  test(`${mode} chosen at ${tokens} tokens is ${color}`, async ($, on) => {
    expect(await chosen($, on, mode, tokens)).toBe(color)
  })
}

test('ultra measures against its own hard limit', async ($, on) => {
  on('state.get', stored({ meter: { tokens: 120_000 }, conf: CONF, mode: 'ultra' }))
  const ui = await $.ui.mount(SLOT)

  expect((await ui.find({ type: 'Text', text: /Context/ }))?.text).toBe('Context medium (120K used of 250K)')
  await ui.unmount()
})

test('the mode button opens the four modes, a press picks one and keeps it, and [-] goes back', async ($, on) => {
  const kept: Record<string, unknown> = { conf: CONF }
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, tokens: 60_000 } } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pocketbook' } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(SLOT)

  expect((await ui.find({ type: 'Text', text: /Context/ }))?.text).toBe('Context high (60K used of 300K)')
  await ui.press({ key: 'mode' })
  expect((await ui.find({ type: 'Text', text: /auto/ }))?.text).toBe('[ auto ]')

  await ui.press({ key: 'mode:lite' })
  expect((await ui.find({ type: 'Text', text: /lite/ }))?.text).toBe('[ lite ]')
  expect(kept.mode).toBe('lite')

  await ui.press({ key: 'close' })
  expect((await ui.find({ type: 'Text', text: /Context/ }))?.text).toBe('Context high (60K used of 300K)')
  await ui.unmount()
})

test('the first session works the limits out from the compaction window and keeps them', async ($, on) => {
  const kept: Record<string, unknown> = {}
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.usage', () => ({
    value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, breakdown: { rawMaxTokens: 300_000, autocompactSource: 'env' } } },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pocketbook' } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(kept.conf).toEqual(CONF)
})
