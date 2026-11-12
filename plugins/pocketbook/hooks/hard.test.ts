import { expect, mock, test } from 'claude-code/testing'

const CONF = { ceiling: 300_000, soft: 225_000, hard: 300_000, ultraSoft: 175_000, ultraHard: 250_000, isSetUp: true }
const MESSAGES = [{ role: 'user', text: 'summary', toolUses: [] }]
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

// A started session past the hard limit, the engine stood in for; `seen` records what the mod did to it.
const session = async ($: any, on: any, mode: string) => {
  const seen = { compactions: 0, prompts: [] as string[], logs: [] as string[], status: undefined as string | undefined, config: undefined as unknown }
  const files: Record<string, string> = {}
  const clock = mock.clock(on)
  let tokens: number | undefined = 310_000
  mock.store(on, { conf: CONF, mode })
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[e.path] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000, tokens } } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pocketbook' } }))
  on('config.set', (_: unknown, e: { key: string; value: unknown }) => {
    seen.config = e

    return { value: e.value }
  })
  on('agent.list', () => ({ value: [] }))
  on('ui.status', (_: unknown, e: { text?: string }) => {
    seen.status = e.text

    return { value: undefined }
  })
  on('ui.log', (_: unknown, e: { text: string }) => {
    seen.logs.push(e.text)

    return { value: undefined }
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', (_: unknown, e: { tool: string }) => ({ result: e.tool === 'Bash' ? { backgroundTaskId: 'sh1' } : {} }))
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    seen.prompts.push(e.text)

    return { text: e.text }
  })
  on('session.compact', () => {
    seen.compactions += 1
    tokens = undefined // a compacted conversation has no size until its next reply

    return { messages: MESSAGES }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  return { seen, clock }
}

test('Claude Code\'s own automatic compaction is turned off', async ($, on) => {
  const { seen } = await session($, on, 'auto')

  expect(seen.config).toEqual(expect.objectContaining({ key: 'autoCompact', value: false }))
})

test('with nothing in the background, the reply that passes the hard limit is followed by a compaction', async ($, on) => {
  const { seen, clock } = await session($, on, 'auto')

  await $.turn.complete(TURN)
  expect(seen.compactions).toBe(0) // not inside the turn
  await clock.advance(250)

  expect(seen.compactions).toBe(1)
  expect(seen.status).toBeUndefined()
  expect(seen.prompts).toEqual([]) // an empty todo list starts nothing
})

test('lite never compacts', async ($, on) => {
  const { seen, clock } = await session($, on, 'lite')

  await $.turn.complete(TURN)
  await clock.advance(250)

  expect(seen.compactions).toBe(0)
  expect((await $.prompt.submit({ text: 'carry on' })).drop).toBeUndefined()
})

test('with a shell in the background the conversation is held, prompts are kept on the todo list, and it is compacted once the shell ends', async ($, on) => {
  const { seen, clock } = await session($, on, 'auto')
  await $.tool.call({ tool: 'Bash', command: 'npm run build', run_in_background: true })

  await $.turn.complete(TURN)
  await clock.advance(250)
  expect(seen.compactions).toBe(0)
  expect(seen.status).toBe('Compact limit reached: compacting once background work has ended.')
  expect(seen.logs.at(-1)).toBe('Compact limit reached: not responding until the background shell or agent ends and the chat is compacted.')

  expect((await $.prompt.submit({ text: 'add a login page' })).drop).toBe(
    'Compact limit reached: not responding until the background shell or agent ends and the chat is compacted.\n\nTodo:\nadd a login page [1]',
  )
  expect((await $.prompt.submit({ text: 'stop' })).drop).toBeUndefined()
  expect((await $.session.compact({ trigger: 'auto', messages: MESSAGES })).skip).toBe('Pocketbook is waiting for background work to end before compacting.')
  expect(seen.compactions).toBe(0)

  await $.tool.call({ tool: 'TaskStop', task_id: 'sh1' })
  await $.turn.complete(TURN)
  await clock.advance(250)

  expect(seen.compactions).toBe(1)
  expect(seen.status).toBeUndefined()
  expect(seen.logs.at(-1)).toBe('Todo:\nadd a login page [1]')
  expect(seen.prompts.at(-1)).toContain('Work through the todo list in .pocketbook/todo.md one item at a time')
})

test('force: lets a prompt through while held and forgets the shells counted', async ($, on) => {
  const { seen, clock } = await session($, on, 'ultra')
  await $.tool.call({ tool: 'Bash', command: 'sleep 999', run_in_background: true })
  await $.turn.complete(TURN)

  expect((await $.prompt.submit({ text: 'force: answer anyway' })).drop).toBeUndefined()
  await $.turn.complete(TURN)
  await clock.advance(250)

  expect(seen.compactions).toBe(1)
})

test('a compaction the person asks for is never refused, and hands the todo list over', async ($, on) => {
  const { seen, clock } = await session($, on, 'auto')
  await $.tool.call({ tool: 'Bash', command: 'sleep 999', run_in_background: true })
  await $.turn.complete(TURN)
  await $.prompt.submit({ text: 'write the docs' }) // refused, kept

  expect((await $.session.compact({ trigger: 'manual', messages: MESSAGES })).skip).toBeUndefined()
  await clock.settle() // the hand-over is a prompt of its own, sent without waiting
  expect(seen.prompts.at(-1)).toContain('write the docs [1]')
})

test('a reply is never compacted under way: not at a tool call, not when a subagent finishes', async ($, on) => {
  const { seen, clock } = await session($, on, 'auto')

  await $.tool.call({ tool: 'Read', file_path: 'a.txt' }) // past the hard limit, mid-reply
  await $.turn.complete({ ...TURN, agentId: 'sub1' }) // a subagent finishing inside the reply
  await clock.advance(1000)

  expect(seen.compactions).toBe(0)
})
