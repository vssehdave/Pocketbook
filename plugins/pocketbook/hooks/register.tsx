import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Conf, Meter, Mode } from '../types'
import { K, MODES, band, ceilingOf, defaults, isMode, leftOf, limitsOf, rule, softNote } from './lib'
import { PATTERN, confFor, hardLimit, sizesOf, suggested, table, tokensIn } from './analysis'
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
  await note($)
}

// Where the conversation stands once it is past the mode's soft limit, against the limit the footer shows; nothing before that.
async function pastSoft($: any) {
  const m = await read($, meter)
  const limits = await read($, conf)

  if (m === null || limits === null) {
    return undefined
  }

  const { soft, shown } = limitsOf(limits, await read($, mode))

  return soft !== undefined && m.tokens >= soft ? { tokens: m.tokens, limit: shown } : undefined
}

// The status line holds the soft-limit note for as long as it is true, and is cleared when it stops being.
async function note($: any) {
  const past = await pastSoft($)
  $.ui.status(past === undefined ? undefined : softNote(past.tokens, past.limit))
}

// Reads the size after the engine has done its part, so the figure is the reply's, not the one before.
async function refresh($: any) {
  const { context } = await $.session.usage()
  await update($, meter, () => (context.tokens === undefined ? null : { tokens: context.tokens }))
  await note($)
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

// The context size of every request in the transcripts of the last `days` days, per conversation. Claude Code keeps them under its
// configuration folder; git pulls the counts out, a few files at a time so no answer is cut.
async function history($: any, days: number): Promise<number[][]> {
  const home = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))}/.claude`
  const root = `${home}/projects`
  const since = (await $.clock.now()) - days * 86_400_000
  const batches: string[][] = [[]]
  let size = 0

  for (const dir of (await $.fs.list(root).catch(() => [])) as Array<{ name: string; kind: string }>) {
    if (dir.kind !== 'dir') {
      continue
    }

    for (const file of (await $.fs.list(`${root}/${dir.name}`).catch(() => [])) as Array<{ name: string; kind: string; size: number; mtimeMs: number }>) {
      if (file.kind !== 'file' || !file.name.endsWith('.jsonl') || file.mtimeMs < since) {
        continue
      }

      if (size + file.size > 15_000_000 || batches.at(-1)!.length >= 20) {
        batches.push([])
        size = 0
      }

      batches.at(-1)!.push(`${dir.name}/${file.name}`)
      size += file.size
    }
  }

  const sizes = new Map<string, number[]>()

  for (const batch of batches) {
    if (batch.length > 0) {
      const { stdout } = await $.process.run(['git', 'grep', '--no-index', '-n', '-o', '-E', PATTERN, '--', ...batch], { cwd: root, timeoutMs: 120_000 })
      sizesOf(stdout, sizes)
    }
  }

  return [...sizes.values()]
}

// /pocketbook setup: shows what each soft limit would have saved over the person's own history, lets them pick one, and works the
// hard limits out from where their conversations went after it.
async function setup($: any, typed: string): Promise<string> {
  const days = /^\d+$/.test(typed) ? Math.max(1, Number(typed)) : 14
  const before = (await read($, conf)) ?? defaults(ceilingOf((await $.session.usage()).context.window))
  const sessions = await history($, days).catch(() => [] as number[][])
  const rows = table(sessions, before.ceiling)
  const best = suggested(rows) ?? before.soft
  const report =
    sessions.length === 0
      ? `Found no conversations from the last ${days} days to learn from (git is needed to read them), so the choices below are not measured.`
      : [
          `Looked at ${sessions.length} conversations from the last ${days} days (${sessions.flat().length} requests).`,
          '',
          'Soft limit   Tokens read past it   Conversations that reached it',
          ...rows.map(row => `${K(row.limit).padEnd(13)}${`${row.saved}%`.padEnd(22)}${row.reached}%`),
          '',
          'Tokens read past a limit are what a compaction there could have spared. A lower limit spares more and interrupts more conversations.',
        ].join('\n')
  // The dialog takes four choices: the suggestion and the three limits nearest it. Any other is typed under "Other".
  const others = rows
    .map(row => row.limit)
    .filter(limit => limit !== best)
    .sort((a, b) => Math.abs(a - best) - Math.abs(b - best))
    .slice(0, 3)
    .sort((a, b) => a - b)
  $.ui.log(report) // shown while the question is up; the answer below repeats it for the record
  const answer = await $.ui
    .ask('Where should the soft limit be?', {
      header: 'Soft limit',
      options: [`${K(best)} (suggested)`, ...(others.length > 0 ? others.map(K) : [K(best - 50_000)])],
    })
    .catch(() => undefined)
  const soft = answer === undefined ? NaN : tokensIn(answer)

  if (answer === undefined) {
    return `${report}\n\nNothing was changed. Run /pocketbook setup again to pick a soft limit.`
  }

  if (!(soft >= 50_000 && soft < before.ceiling)) {
    return `${report}\n\nNothing was changed: the soft limit has to be between 50K and ${K(before.ceiling)}.`
  }

  const picked = confFor(sessions, soft, before.ceiling)
  await $.store.set('conf', picked)
  await update($, conf, () => picked)
  await writeList($, TODO, await readList($, TODO))
  await writeList($, BACKLOG, await readList($, BACKLOG))
  const { passed } = hardLimit(sessions, soft, before.ceiling)

  return [
    report,
    '',
    `Soft limit ${K(picked.soft)}, hard limit ${K(picked.hard)}.`,
    passed === 0
      ? `No conversation passed ${K(picked.soft)}, so the hard limit is 50K over it.`
      : `${passed} conversations passed ${K(picked.soft)}; 80% of them peaked at or under ${K(picked.hard)}.`,
    `  lite   notes at ${K(picked.soft)}, never compacts`,
    `  auto   notes at ${K(picked.soft)}, compacts at ${K(picked.hard)}`,
    `  ultra  notes at ${K(picked.ultraSoft)}, compacts at ${K(picked.ultraHard)}`,
    `The todo list is ${TODO}, the backlog ${BACKLOG}.`,
  ].join('\n')
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

  if (word === 'setup') {
    return setup($, rest)
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

  // Past the soft limit the model reads the rule beside every prompt, so it is always measured against the room left now.
  on('prompt.submit', async ($, e, next) => {
    const past = e.command === undefined ? await pastSoft($) : undefined

    return next(past === undefined ? e : { ...e, context: [...(e.context ?? []), rule(past.tokens, past.limit, TODO)] })
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
