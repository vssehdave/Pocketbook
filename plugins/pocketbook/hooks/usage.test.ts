import { expect, mock, test } from 'claude-code/testing'

const CONF = { ceiling: 300_000, soft: 225_000, hard: 300_000, ultraSoft: 175_000, ultraHard: 250_000, isSetUp: true }
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const
const LONG = `${'a request that goes on '.repeat(6)}and on`

// A started session with 60K tokens in it, the engine stood in for; `seen` records what the mod did.
const session = async ($: any, on: any) => {
  const seen = { logs: [] as string[], opens: [] as string[], prompts: [] as Array<{ text: string; context?: string[] }>, completions: 0 }
  const files: Record<string, string> = {}
  const clock = mock.clock(on)
  mock.store(on, { conf: CONF, mode: 'auto' })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, tokens: 60_000 } } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pocketbook' } }))
  on('config.set', (_: unknown, e: { value: unknown }) => ({ value: e.value }))
  on('agent.list', () => ({ value: [] }))
  on('ui.open', (_: unknown, e: { id: string; title?: string }) => {
    seen.opens.push(e.title ?? '')

    return { value: { isPlaced: true } }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', (_: unknown, e: { text: string }) => {
    seen.logs.push(e.text)

    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', () => ({ turnId: 't' }))
  on('session.measure', (_: unknown, e: { changed: string[] }) => ({ changed: e.changed }))
  on('model.complete', () => {
    seen.completions += 1

    return { value: { isAnswered: true, text: 'a summary' } }
  })
  on('prompt.submit', (_: unknown, e: { text: string; context?: string[] }) => {
    seen.prompts.push({ text: e.text, context: e.context })

    return { text: e.text }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  return Object.assign(seen, { clock })
}

const measure = ($: any, percentUsed: number, kind = 'five_hour') =>
  $.session.measure({ context: { window: 1_000_000, tokens: 60_000 }, rateLimits: [{ kind, percentUsed, resetsAt: '2026-11-12T12:00:00Z' }], changed: ['rateLimits'] })

const add = ($: any, text: string) => $.command.run({ command: 'pocketbook', args: `todo -add ${text}` })

test('near the end of a window the todo list is shown once, with the word that -add keeps working', async ($, on) => {
  const seen = await session($, on)
  await add($, 'first task')

  await measure($, 90)
  expect(seen.logs).toEqual([])
  await measure($, 95)
  await measure($, 96)

  expect(seen.logs.join('\n')).toContain('95% of the five-hour limit')
  expect(seen.opens).toEqual(['Todo']) // only by the one -add typed above, never by the warning
  expect(seen.logs.join('\n')).not.toContain('first task') // the list is in its pane, not a log row
  expect(seen.logs.every(line => !line.includes('\n'))).toBe(true) // one row a line: the engine garbles a break inside one
  await measure($, 97)
  expect(seen.logs.filter(line => line.includes('five-hour limit'))).toHaveLength(1) // said once
})

test('with usage out, -add keeps the request as its first line and asks no model', async ($, on) => {
  const seen = await session($, on)
  await measure($, 100)

  const answer = (await add($, LONG)).text

  expect(seen.completions).toBe(0)
  expect(answer).toContain('Added.')
})

test('a todo added during a reply is handed to the model when the reply ends', async ($, on) => {
  const seen = await session($, on)
  await $.turn.start({ text: 'work', turnId: 't' })
  await add($, 'second task')
  expect(seen.prompts).toEqual([])
  await $.turn.complete(TURN)
  await seen.clock.advance(250) // the hand-over is not awaited by the hook

  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]!.text).toContain('second task [t1]')
})

test('a todo added when no reply is running starts nothing', async ($, on) => {
  const seen = await session($, on)
  await add($, 'idle task')
  await $.turn.start({ text: 'work', turnId: 't' })
  await $.turn.complete(TURN)

  expect(seen.prompts).toEqual([])
})

test('with usage out the reply is not followed by a prompt; the next prompt carries the word instead', async ($, on) => {
  const seen = await session($, on)
  await $.turn.start({ text: 'work', turnId: 't' })
  await add($, 'third task')
  await measure($, 100)
  await $.turn.complete(TURN)

  expect(seen.prompts).toEqual([])
  expect(seen.logs.join('\n')).toContain('Usage is used up')

  await $.prompt.submit({ text: 'carry on' })

  expect(seen.prompts.at(-1)!.context?.join(' ')).toContain('todo items were added while you worked')
})
