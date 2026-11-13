import { expect, test } from 'claude-code/testing'

// The engine's part, stood in for: a file system held in memory, a store, and a session that starts.
// The engine hands a hook the path made absolute; the files here are named from the working directory.
const named = (path: string) => path.replace(/\\/g, '/').replace(/^.*\/plugins\/pocketbook\//, '')

const world = (on: any, files: Record<string, string> = {}, context: Record<string, unknown> = { window: 1_000_000 }) => {
  const kept: Record<string, unknown> = {}
  const opens: Array<{ id: string; title: string }> = []
  on('ui.open', (_: unknown, e: { id: string; title: string }) => {
    opens.push(e)

    return { value: { isPlaced: true } }
  })
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
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'pocketbook' } }))

  return { files, kept, opens }
}

const pocketbook = async ($: any, args: string) => (await $.command.run({ command: 'pocketbook', args })).text

test('the todo and backlog commands change the lists and open the list pane', async ($, on) => {
  const { files, opens } = world(on, { '.gitignore': 'node_modules/' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const summaries = (path: string) => (files[path] ?? '').split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2))
  const todo = () => summaries('.pocketbook/todo.md')

  expect(await pocketbook($, 'todo')).toBeUndefined()
  expect(opens.at(-1)).toEqual({ id: 'pocketbook-list', title: 'Todo', closeOnEscape: true })
  await pocketbook($, 'todo -add first task')
  await pocketbook($, 'todo -add second task')
  expect(await pocketbook($, 'todo -add third task')).toBe('Added.')
  expect(todo()).toEqual(['first task', 'second task', 'third task'])
  expect(files['.gitignore']).toBe('node_modules/\n.pocketbook/\n') // added once, not once per write

  expect(await pocketbook($, 'push t2')).toBe('Moved to the backlog: second task')
  expect(todo()).toEqual(['first task', 'third task'])
  expect(summaries('.pocketbook/backlog.md')).toEqual(['second task'])
  expect(await pocketbook($, 'remove t1')).toBe('Removed: first task')
  expect(todo()).toEqual(['third task'])
  expect(await pocketbook($, 'remove t5')).toBe('Give the number of an item, 1 to 1.')
  expect(await pocketbook($, 'push -all')).toBe('Moved 1 to the backlog.')
  expect(todo()).toEqual([])
  expect(await pocketbook($, 'backlog')).toBeUndefined()
  expect(opens.at(-1)?.id).toBe('pocketbook-list')
  expect(summaries('.pocketbook/backlog.md')).toEqual(['second task', 'third task'])
})

test('work starts the whole list or one item, and refuses a bad number or an empty list', async ($, on) => {
  world(on, { '.pocketbook/todo.md': '# Pocketbook todo\n\n- first\n  the full first request\n- second\n' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await pocketbook($, 'work t9')).toBe('Give the number of an item, 1 to 2.')
  expect(await pocketbook($, 'work')).toBe('Started on 2 items.')
  expect(await pocketbook($, 'work t2')).toBe('Started on: second')
  await pocketbook($, 'remove t1')
  await pocketbook($, 'remove t1')
  expect(await pocketbook($, 'work')).toBe('The todo list is empty.')
})

test('mode:: changes the mode and keeps it', async ($, on) => {
  const { kept } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ultra = await pocketbook($, 'mode::ultra')
  expect(ultra.split('\n')[0]).toBe('Pocketbook is on at ultra mode.')
  expect(ultra.split('\n')[1]).toMatch(/^ultra {2}notes at \d+K, compacts at \d+K$/)
  expect(await pocketbook($, 'mode::lite')).toMatch(/^Pocketbook is on at lite mode.\nlite {3}notes at \d+K, never compacts$/)
  kept.history = { count: 2, saved: 640_000 }
  expect(await pocketbook($, 'mode::off')).toBe('Pocketbook is off.\nCompacted 2 times so far, shrinking the context by 640K tokens in total.')
  expect(await pocketbook($, 'mode::auto')).toMatch(/^Pocketbook is back on at auto mode.\nauto {3}notes at/)
  expect(kept.mode).toBe('auto')
  expect(await pocketbook($, 'mode::loud')).toBe('The mode is auto. Pick one of: off, lite, auto, ultra.')
})

test('setup -units toggles between tokens and percent, or sets one, and keeps it', async ($, on) => {
  const { kept } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await pocketbook($, 'setup -units')).toBe('The footer now shows percent.')
  expect(kept.units).toBe('percent')
  expect(await pocketbook($, 'setup -units')).toBe('The footer now shows tokens.')
  expect(await pocketbook($, 'setup -units %')).toBe('The footer now shows percent.')
  expect(await pocketbook($, 'setup -units tokens')).toBe('The footer now shows tokens.')
})

// A started session with Claude Code's compaction window set in its environment, and its own auto-compact on or off.
const withWindow = async ($: any, on: any, isAutoCompactEnabled: boolean) => {
  world(on, {}, { window: 1_000_000, breakdown: { isAutoCompactEnabled, rawMaxTokens: 300_000, autocompactSource: 'env' } })
  on('env.get', (_: unknown, e: { name: string }) => ({ value: e.name === 'CLAUDE_CODE_AUTO_COMPACT_WINDOW' ? '300k' : undefined }))
  on('fs.list', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

test('setup says where the Claude Code warning comes from when its window is set and auto-compact is off', async ($, on) => {
  await withWindow($, on, false)

  const text = await pocketbook($, 'setup')

  expect(text).toContain('CLAUDE_CODE_AUTO_COMPACT_WINDOW')
  expect(text).toContain('Remove the setting from the env block of settings.json')
})

test('setup is silent about the window when auto-compact is on', async ($, on) => {
  await withWindow($, on, true)

  expect(await pocketbook($, 'setup')).not.toContain('CLAUDE_CODE_AUTO_COMPACT_WINDOW')
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

test('details shows the whole request of an item in the pane, with no model', async ($, on) => {
  const { opens } = world(on, {
    '.pocketbook/todo.md': '# Pocketbook todo\n\n- Short summary\n  First line of the request\n  second line of it\n',
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await pocketbook($, 'details t1')).toBeUndefined()
  expect(opens.at(-1)?.id).toBe('pocketbook-list')
  const pane = await $.ui.mount({ plugin: 'pocketbook', component: 'Pane', requestId: 'pocketbook-list', surface: 'terminal', props: {} })

  expect((await pane.find({ type: 'Text', text: /TODO #1/ }))?.text).toBe(' TODO #1 ')
  expect((await pane.find({ type: 'Text', text: /First line/ }))?.text).toBe('First line of the request')
  expect((await pane.find({ type: 'Text', text: /second line/ }))?.text).toBe('second line of it')
  await pane.unmount()

  expect(await pocketbook($, 'details t9')).toBe('Give the number of an item, 1 to 1.')
  expect(await pocketbook($, 'details b1')).toBe('The backlog list is empty.')
  expect(await pocketbook($, 'details nope')).toMatch(/Name the item/)
})

const IGNORE_CASES: Array<[string, string | undefined, string]> = [
  ['there is no .gitignore', undefined, '.pocketbook/\n'],
  ['it has other lines and no final break', 'dist', 'dist\n.pocketbook/\n'],
  ['it names the folder', 'dist\n.pocketbook/\n', 'dist\n.pocketbook/\n'],
  ['it names it from the root', '/.pocketbook\n', '/.pocketbook\n'],
  ['it names it without the slash, with Windows breaks', 'dist\r\n.pocketbook\r\n', 'dist\r\n.pocketbook\r\n'],
  ['it only mentions it in a comment', '# .pocketbook\n', '# .pocketbook\n.pocketbook/\n'],
]

for (const [when, before, after] of IGNORE_CASES) {
  test(`.pocketbook/ is in .gitignore before a list is written when ${when}`, async ($, on) => {
    const { files } = world(on, before === undefined ? {} : { '.gitignore': before })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

    await pocketbook($, 'todo -add first task')
    await pocketbook($, 'backlog -add parked task')
    expect(files['.gitignore']).toBe(after)
    expect(files['.pocketbook/todo.md']).toBeDefined()
  })
}

const summariesOf = (text: string | undefined) => (text ?? '').split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2))

test('the backlog has the todo list commands, and pop and pop -all bring items back', async ($, on) => {
  const { files } = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const todo = () => summariesOf(files['.pocketbook/todo.md'])
  const backlog = () => summariesOf(files['.pocketbook/backlog.md'])

  expect(await pocketbook($, 'backlog -add first parked')).toBe('Added.')
  await pocketbook($, 'backlog -add second parked')
  expect(backlog()).toEqual(['first parked', 'second parked'])
  expect(todo()).toEqual([])

  expect(await pocketbook($, 'pop b1')).toBe('Moved to the todo list: first parked')
  expect(todo()).toEqual(['first parked'])
  expect(backlog()).toEqual(['second parked'])
  expect(await pocketbook($, 'push t1')).toBe('Moved to the backlog: first parked')
  expect(await pocketbook($, 'pop -all')).toBe('Moved 2 to the todo list.')
  expect(todo()).toEqual(['second parked', 'first parked'])
  expect(backlog()).toEqual([])

  expect(await pocketbook($, 'pop -all')).toBe('The backlog list is empty.')
  expect(await pocketbook($, 'pop b1')).toBe('The backlog list is empty.')
  expect(await pocketbook($, 'remove b1')).toBe('The backlog list is empty.')
  await pocketbook($, 'backlog -add to delete')
  expect(await pocketbook($, 'remove b2')).toBe('Give the number of an item, 1 to 1.')
  expect(await pocketbook($, 'remove b1')).toBe('Removed: to delete')
  expect(backlog()).toEqual([])

  expect(await pocketbook($, 'remove b -all')).toBe('The backlog list is empty.')
  await pocketbook($, 'backlog -add one')
  await pocketbook($, 'backlog -add two')
  expect(await pocketbook($, 'remove b -all')).toBe('Removed all 2 from the backlog.')
  expect(backlog()).toEqual([])
})

test('todo and backlog open their own list alone, and show is the one that gives both', async ($, on) => {
  world(on, { '.pocketbook/todo.md': '# Pocketbook todo\n\n- a todo item\n', '.pocketbook/backlog.md': '# Pocketbook backlog\n\n- a parked item\n' })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const slot = { plugin: 'pocketbook', component: 'Pane', requestId: 'pocketbook-list', surface: 'terminal', props: {} } as const

  await pocketbook($, 'todo')
  let pane = await $.ui.mount(slot)
  expect(await pane.find({ type: 'Text', text: /a todo item/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /a parked item/ })).toBeUndefined()
  await pane.unmount()

  await pocketbook($, 'backlog')
  pane = await $.ui.mount(slot)
  expect(await pane.find({ type: 'Text', text: /a parked item/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /a todo item/ })).toBeUndefined()
  await pane.unmount()
})

test('edit puts an item in the prompt box to change, and rewrites it when given the new text', async ($, on) => {
  const filled: string[] = []
  const { files } = world(on, { '.pocketbook/todo.md': '# Pocketbook todo\n\n- first\n  the full first request\n- second\n', '.pocketbook/backlog.md': '# Pocketbook backlog\n\n- parked\n' })
  on('prompt.fill', (_: unknown, e: { text: string }) => {
    filled.push(e.text)

    return { isFilled: true }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  expect(await pocketbook($, 'edit 1')).toBe('Name the item by its list and number: t<n> for the todo list, b<n> for the backlog.')
  expect(await pocketbook($, 'edit t9')).toBe('Give the number of an item, 1 to 2.')
  expect(await pocketbook($, 'edit b1')).toBeUndefined()
  expect(filled.at(-1)).toBe('/pocketbook edit b1 parked')
  expect(await pocketbook($, 'edit t1')).toBeUndefined()
  expect(filled.at(-1)).toBe('/pocketbook edit t1 the full first request') // the whole request, not the summary

  expect(await pocketbook($, 'edit t2 second, reworded')).toBe('Edited.')
  expect(files['.pocketbook/todo.md']).toContain('- second, reworded')
  expect(files['.pocketbook/todo.md']).toContain('- first')
  expect(await pocketbook($, 'edit B1 parked again')).toBe('Edited.')
  expect(files['.pocketbook/backlog.md']).toContain('- parked again')
})

test('push and pop take the right list, and remove names its list by the letter', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await pocketbook($, 'todo -add a todo item')
  await pocketbook($, 'backlog -add a parked item')

  expect(await pocketbook($, 'push b1')).toBe('push moves a todo item to the backlog: push t<n>, or push -all.')
  expect(await pocketbook($, 'pop t1')).toBe('pop brings a backlog item back to the todo list: pop b<n>, or pop -all.')
  expect(await pocketbook($, 'remove 1')).toBe('Name the item by its list and number: t<n> for the todo list, b<n> for the backlog.')
  expect(await pocketbook($, 'remove x1')).toBe('Name the item by its list and number: t<n> for the todo list, b<n> for the backlog.')
  expect(await pocketbook($, 'work b1')).toBe('work takes a todo item: work t<n>.')
  expect(await pocketbook($, 'remove t -all')).toBe('Removed all 1 from the todo list.')
  expect(await pocketbook($, 'remove t -all')).toBe('The todo list is empty.')
  expect(await pocketbook($, 'remove b1')).toBe('Removed: a parked item')
})
