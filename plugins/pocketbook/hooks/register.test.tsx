import { expect, test } from 'claude-code/testing'

const SLOT = { plugin: 'pocketbook', component: 'SessionMode', surface: 'terminal', props: { modes: [] as string[] } } as const

// What the session had stored: the last context size, in tokens.
const stored = (tokens: number | null) => () => ({ value: { value: tokens === null ? null : { tokens }, version: 1 } })

const cases = [
  { tokens: 60_000, text: 'Context high (80% remaining)' },
  { tokens: 90_000, text: 'Context high (70% remaining)' }, // 70% is still high
  { tokens: 93_000, text: 'Context medium (69% remaining)' }, // just under 70
  { tokens: 195_000, text: 'Context medium (35% remaining)' }, // 35% is still medium
  { tokens: 198_000, text: 'Context low (34% remaining)' }, // just under 35
  { tokens: 450_000, text: 'Context low (0% remaining)' }, // past the window: 0, never negative
]

for (const c of cases) {
  test(`${c.tokens} tokens reads "${c.text}"`, async ($, on) => {
    on('state.get', stored(c.tokens))
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
  on('state.get', stored(null))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const ui = await $.ui.mount(SLOT)

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
