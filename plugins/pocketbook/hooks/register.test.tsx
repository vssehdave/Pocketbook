import { expect, test } from 'claude-code/testing'

const SLOT = { plugin: 'pocketbook', component: 'SessionMode', surface: 'terminal', props: { modes: [] as string[] } } as const
const CONF = { ceiling: 300_000, soft: 225_000, hard: 300_000, ultraSoft: 175_000, ultraHard: 250_000, isSetUp: false }

// What the session had stored, by key: the last context size and the limits.
const stored = (state: Record<string, unknown>) => (_: unknown, e: { key: string }) => ({ value: { value: state[e.key], version: 1 } })

const cases = [
  { tokens: 60_000, text: 'Context high 60K of 300K' },
  { tokens: 93_000, text: 'Context medium 93K of 300K' }, // just under 70% left
  { tokens: 198_000, text: 'Context low 198K of 300K' }, // just under 35% left
  { tokens: 450_000, text: 'Context low 450K of 300K' }, // past the limit
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

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
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

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(kept.conf).toEqual(CONF)
})
