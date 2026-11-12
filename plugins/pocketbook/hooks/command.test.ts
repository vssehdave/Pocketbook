import { expect, test } from 'claude-code/testing'

// The engine's part, stood in for: a file system held in memory, a store, and a session that starts.
// The engine hands a hook the path made absolute; the files here are named from the working directory.
const named = (path: string) => path.replace(/\\/g, '/').replace(/^.*\/plugins\/pocketbook\//, '')

const world = (on: any, files: Record<string, string> = {}) => {
  const kept: Record<string, unknown> = {}
  on('fs.exists', (_: unknown, e: { path: string }) => ({ value: named(e.path) in files }))
  on('fs.read', (_: unknown, e: { path: string }) => ({ value: files[named(e.path)] }))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    files[named(e.path)] = e.text

    return { value: undefined }
  })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: kept[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1_000_000 } } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pocketbook' } }))

  return { files, kept }
}

const pocketbook = async ($: any, args: string) => (await $.command.run({ command: 'pocketbook', args })).text

test('the todo list is added to, listed, stashed, removed from and archived', async ($, on) => {
  const { files } = world(on, { '.gitignore': 'node_modules/' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await pocketbook($, 'todo')).toBe('The todo list is empty.')
  await pocketbook($, 'todo -add first task')
  await pocketbook($, 'todo -add second task')
  expect(await pocketbook($, 'todo -add third task')).toBe('Added. The todo list:\nfirst task [1]\nsecond task [2]\nthird task [3]')
  expect(files['.gitignore']).toBe('node_modules/\n.pocketbook/\n') // added once, not once per write

  expect(await pocketbook($, 'stash 2')).toBe('Moved to the backlog: second task')
  expect(await pocketbook($, 'todo -remove 1')).toBe('Removed: first task')
  expect(await pocketbook($, 'todo -remove 5')).toBe('Give the number of an item, 1 to 1.')
  expect(await pocketbook($, 'archive')).toBe('Moved 1 to the backlog.')
  expect(await pocketbook($, 'todo')).toBe('The todo list is empty.')
  expect(await pocketbook($, 'backlog')).toBe('second task [1]\nthird task [2]')
})

test('mode:: changes the mode and keeps it', async ($, on) => {
  const { kept } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await pocketbook($, 'mode::ultra')).toBe('The mode is now ultra.')
  expect(kept.mode).toBe('ultra')
  expect(await pocketbook($, 'mode::loud')).toBe('The mode is ultra. Pick one of: off, lite, auto, ultra.')
})

test('anything else lists the commands', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await pocketbook($, 'help')).toContain('todo -add <text>')
})

test('setup reads the history, asks for the soft limit and keeps the limits it works out', async ($, on) => {
  const { files, kept } = world(on)
  let asked: unknown
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'HOME' ? '/home/me' : undefined }))
  on('clock.now', () => ({ value: 20 * 86_400_000 }))
  on('fs.list', (_: unknown, e: { path: string }) => ({
    value: e.path.endsWith('projects')
      ? [{ name: 'proj', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }]
      : [
          { name: 'new.jsonl', kind: 'file', size: 10, mtimeMs: 19 * 86_400_000, isLink: false },
          { name: 'old.jsonl', kind: 'file', size: 10, mtimeMs: 86_400_000, isLink: false }, // older than 14 days
        ],
  }))
  on('process.run', (_: unknown, e: { argv: string[] }) => {
    expect(e.argv.slice(-2)).toEqual(['--', 'proj/new.jsonl'])

    return {
      value: {
        exitCode: 0,
        stderr: '',
        stdout: ['"id":"msg_1"', '"input_tokens":120000', '"id":"msg_2"', '"input_tokens":230000'].map((m, i) => `proj/new.jsonl:${i >> 1}:${m}`).join('\n'),
      },
    }
  })
  on('ui.log', () => ({ value: undefined }))
  // The question is the engine's own AskUserQuestion call; the person picks 200K.
  on('tool.call', (_: unknown, e: { questions: Array<{ question: string }> }) => {
    asked = e

    return { result: { questions: e.questions, answers: { [e.questions[0]!.question]: '200K' } } }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const text = await pocketbook($, 'setup')

  expect(JSON.stringify(asked)).toContain('200K')
  expect(text).toContain('Looked at 1 conversations from the last 14 days (2 requests).')
  expect(text).toContain('Soft limit 200K, hard limit 250K.')
  expect(kept.conf).toEqual({ ceiling: 800_000, soft: 200_000, hard: 250_000, ultraSoft: 150_000, ultraHard: 250_000, isSetUp: true })
  expect(files['.pocketbook/todo.md']).toBe('# Pocketbook todo\n\n')
})
