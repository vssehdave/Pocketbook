import { expect, test } from 'claude-code/testing'

const CONF = { ceiling: 300_000, soft: 225_000, hard: 300_000, ultraSoft: 175_000, ultraHard: 250_000, isSetUp: true }

// A session of the given size and mode, started; what the status line was last set to is in `seen.status`.
const session = async ($: any, on: any, tokens: number, mode: string) => {
  const seen: { status?: string; context?: readonly string[] } = {}
  on('store.get', (_: unknown, e: { key: string }) => ({ value: e.key === 'conf' ? CONF : mode }))
  on('store.set', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, tokens } } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pocketbook' } }))
  on('ui.status', (_: unknown, e: { text?: string }) => {
    seen.status = e.text

    return { value: undefined }
  })
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    seen.context = e.context

    return { text: e.text }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  return seen
}

test('past the soft limit the status line says so and the model is given the rule', async ($, on) => {
  const seen = await session($, on, 250_000, 'auto')

  expect(seen.status).toBe('Soft limit reached: 250K of 300K used, 50K left. Small and medium tasks only; larger ones go to the bookmark list.')
  await $.prompt.submit({ text: 'rewrite everything' })
  expect(seen.context?.[0]).toContain('about 50K are left')
})

test('under the soft limit nothing is said', async ($, on) => {
  const under = await session($, on, 100_000, 'auto')
  await $.prompt.submit({ text: 'hello' })

  expect(under.status).toBeUndefined()
  expect(under.context).toBeUndefined()
})

test('off mode says nothing past the limit', async ($, on) => {
  expect((await session($, on, 250_000, 'off')).status).toBeUndefined()
})

test('ultra starts earlier and measures against its own hard limit', async ($, on) => {
  expect((await session($, on, 180_000, 'ultra')).status).toContain('180K of 250K used, 70K left')
})
