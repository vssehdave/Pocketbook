import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Conf, Meter, Mode } from '../types'
import { K, MODES, band, ceilingOf, defaults, isMode, leftOf, limitsOf } from './lib'
import { BACKLOG, TODO, listing, parse, pick, serialize, summaryOf } from './todo'
import type { Item } from './todo'

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

async function readList($: any, path: string): Promise<Item[]> {
  return (await $.fs.exists(path)) ? parse(await $.fs.read(path)) : []
}

// The lists are the person's notes, not the project's: the folder is kept out of git wherever there is a repository.
async function writeList($: any, path: string, items: readonly Item[]) {
  await $.fs.write(path, serialize(path === TODO ? 'Pocketbook todo' : 'Pocketbook backlog', items))

  const ignored = (await $.fs.exists('.gitignore')) ? ((await $.fs.read('.gitignore')) as string) : undefined

  if (ignored === undefined ? await $.fs.exists('.git') : !/^\.pocketbook\/?$/m.test(ignored)) {
    await $.fs.write('.gitignore', `${ignored === undefined || ignored.endsWith('\n') || ignored === '' ? (ignored ?? '') : `${ignored}\n`}.pocketbook/\n`)
  }
}

// One line that says what a request asks, with what should not be repeated left out; the first line of the request when no model answers.
async function summarize($: any, text: string) {
  if (text.length <= 100 && !text.includes('\n')) {
    return text.trim()
  }

  const answer = await $.model
    .complete({
      model: 'haiku',
      maxTokens: 60,
      prompt: `Rewrite this request as one line of at most 15 words that keeps what is asked for. Leave out names of people, secrets, file contents and pasted data. Answer with the line alone.\n\n${text}`,
    })
    .catch(() => undefined)

  return answer?.isAnswered ? summaryOf(answer.text) || summaryOf(text) : summaryOf(text)
}

async function addTodo($: any, text: string) {
  const items = await readList($, TODO)
  await writeList($, TODO, [...items, { summary: await summarize($, text), full: text }])
}

const USAGE = `Pocketbook commands:
  setup               pick the limits from your own history
  mode::<name>        off, lite, auto or ultra
  todo                show the todo list
  todo -add <text>    add to it
  todo -remove <n>    remove item n
  stash <n>           move item n to the backlog
  archive             move the whole todo list to the backlog
  backlog             show the backlog`

// What /pocketbook answers for the words typed after it.
async function run($: any, args: string): Promise<string> {
  const [word = '', ...restWords] = args.split(/\s+/)
  const rest = args.slice(word.length).trim()
  const asked = /^mode(?:::(.*))?$/.exec(word)

  if (asked) {
    const picked = (asked[1] ?? rest).trim()

    if (!isMode(picked)) {
      return `The mode is ${await read($, mode)}. Pick one of: ${MODES.join(', ')}.`
    }

    await setMode($, picked)

    return `The mode is now ${picked}.`
  }

  if (word === 'backlog') {
    return listing(await readList($, BACKLOG)) || 'The backlog is empty.'
  }

  const items = await readList($, TODO)

  if (word === 'todo' && rest === '') {
    return listing(items) || 'The todo list is empty.'
  }

  if (word === 'todo' && restWords[0] === '-add') {
    const text = rest.slice('-add'.length).trim()

    if (text === '') {
      return 'Nothing to add: write the task after -add.'
    }

    await addTodo($, text)

    return `Added. The todo list:\n${listing(await readList($, TODO))}`
  }

  const isRemove = word === 'todo' && restWords[0] === '-remove'

  if (isRemove || word === 'stash') {
    const at = pick(items, isRemove ? (restWords[1] ?? '') : rest)

    if (at === undefined) {
      return items.length === 0 ? 'The todo list is empty.' : `Give the number of an item, 1 to ${items.length}.`
    }

    if (!isRemove) {
      await writeList($, BACKLOG, [...(await readList($, BACKLOG)), items[at]!])
    }

    await writeList($, TODO, items.filter((_, i) => i !== at))

    return `${isRemove ? 'Removed' : 'Moved to the backlog'}: ${items[at]!.summary}`
  }

  if (word === 'archive') {
    if (items.length === 0) {
      return 'The todo list is empty.'
    }

    await writeList($, BACKLOG, [...(await readList($, BACKLOG)), ...items])
    await writeList($, TODO, [])

    return `Moved ${items.length} to the backlog.`
  }

  return USAGE
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
    await $.command.register({ name: 'pocketbook', description: 'Context limits, modes, and the todo list', argumentHint: '[setup | mode::<name> | todo | backlog | stash <n> | archive]' })
    await loadConf($)
    await refresh($)

    return result
  })

  on('command.run', { command: 'pocketbook' }, async ($, e) => ({ text: await run($, e.args.trim()) }))

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
