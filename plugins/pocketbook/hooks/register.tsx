import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Conf, Meter, Mode, Units } from '../types'
import { K, MODES, band, ceilingOf, defaults, isMode, leftOf, limitsOf, modeColor, modeLine, modeReport, rule, softNote, usedText } from './lib'
import type { History } from './lib'
import { COMPACTED, PATTERN, confFor, hardLimit, sizesOf, suggested, table, tokensIn } from './analysis'
import { BACKLOG, TODO, listing, oneLine, parse, pick, scrub, serialize, summaryOf } from './todo'
import type { Item } from './todo'

const meter = atom({ plugin: 'pocketbook', key: 'meter' } as const, null as Meter)
const conf = atom({ plugin: 'pocketbook', key: 'conf' } as const, null as Conf | null)
const mode = atom({ plugin: 'pocketbook', key: 'mode' } as const, 'auto' as Mode)
const units = atom({ plugin: 'pocketbook', key: 'units' } as const, 'tokens' as Units)
// Whether the footer shows the four modes to pick from, in place of the meter.
const isModesOpen = atom({ plugin: 'pocketbook', key: 'isModesOpen' } as const, false)

// True while the main conversation is answering. A todo added then is pointed out to the model once that reply is over.
const isTurn = atom({ plugin: 'pocketbook', key: 'isTurn' } as const, false)
const added = atom({ plugin: 'pocketbook', key: 'added' } as const, false)
// The most used of the account's rate-limit windows, 0 to 100, and the windows already warned about (kind and reset time).
const usage = atom({ plugin: 'pocketbook', key: 'usage' } as const, 0)
const warned = atom({ plugin: 'pocketbook', key: 'warned' } as const, [] as readonly string[])

// The usage at which the todo list is shown, so it can still be added to once the account runs out; and the usage that is out.
const NEAR = 95
const OUT = 99

// The background shells this session started that have not reported back. The engine lists running agents but not shells, so they
// are counted here: one in when a Bash call goes to the background, out at its notification or its stop.
const shells = atom({ plugin: 'pocketbook', key: 'shells' } as const, [] as readonly string[])
// True from the reply that passed the hard limit until the conversation is compacted.
const isHeld = atom({ plugin: 'pocketbook', key: 'isHeld' } as const, false)

const HELD = 'Compact limit reached: not responding until the background shell or agent ends and the chat is compacted.'
// What the person may still send while held: these commands, the word stop, and anything that starts with force:.
const FREE = ['pocketbook', 'compact', 'clear']

// The mode is the person's choice, kept across sessions. A mode that does not compact here lets a held conversation go.
async function setMode($: any, picked: Mode) {
  await $.store.set('mode', picked)
  await update($, mode, () => picked)

  if (!(await pastHard($))) {
    await update($, isHeld, () => false)
  }

  await note($)
}

async function pastHard($: any) {
  const m = await read($, meter)
  const limits = await read($, conf)
  const hard = limits === null ? undefined : limitsOf(limits, await read($, mode)).hard

  return m !== null && hard !== undefined && m.tokens >= hard
}

async function isBusy($: any) {
  if ((await read($, shells)).length > 0) {
    return true
  }

  const agents = (await $.agent.list().catch(() => [])) as Array<{ status: string }>

  return agents.some(agent => agent.status === 'pending' || agent.status === 'running' || agent.status === 'waiting')
}

// $.ui.log appends one line, and the engine turns a line break in its text into a replacement character, so a text of several lines is
// logged a row at a time.
function say($: any, text: string) {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== '') {
      $.ui.log(line)
    }
  }
}

const PANE = 'pocketbook-list'
// A counter bumped when either list changes so an open pane redraws, and the first item each half of the pane shows, for a list longer
// than its half has room for.
const rev = atom({ plugin: 'pocketbook', key: 'rev' } as const, 0)
const topTodo = atom({ plugin: 'pocketbook', key: 'topTodo' } as const, 0)
const topBacklog = atom({ plugin: 'pocketbook', key: 'topBacklog' } as const, 0)
// The item whose full request the pane shows in place of the lists, and the first line of it showing; null for the lists.
const detail = atom({ plugin: 'pocketbook', key: 'detail' } as const, null as { list: 'TODO' | 'BACKLOG'; n: number } | null)
const topDetail = atom({ plugin: 'pocketbook', key: 'topDetail' } as const, 0)

// Opens the pane: the todo list on the top half, the backlog on the bottom. Only ever for the person's own press or command: the
// engine draws such an open at any width, and only if it comes before any await. A toast cannot hold a list: it shows three lines.
async function showList($: any) {
  const opening = $.ui.open({ id: PANE, title: 'Todo', closeOnEscape: true })
  await update($, detail, () => null)
  await update($, topTodo, () => 0)
  await update($, topBacklog, () => 0)
  await update($, rev, n => n + 1)
  await opening.catch(() => undefined)
}

// Opens the pane on one item's full request, which is kept whole in the list file: nothing here calls a model.
async function showDetail($: any, list: 'TODO' | 'BACKLOG', n: number) {
  const opening = $.ui.open({ id: PANE, title: 'Todo', closeOnEscape: true })
  await update($, detail, () => ({ list, n }))
  await update($, topDetail, () => 0)
  await update($, rev, k => k + 1)
  await opening.catch(() => undefined)
}

// A text in lines of at most `width` characters, broken at spaces and where the text itself breaks; a word longer than a line is cut.
function wrapText(text: string, width: number): string[] {
  const lines: string[] = []

  for (const para of text.split(/\r?\n/)) {
    let line = ''

    for (let word of para.split(/\s+/).filter(Boolean)) {
      for (; word.length > width; word = word.slice(width)) {
        if (line !== '') {
          lines.push(line)
          line = ''
        }

        lines.push(word.slice(0, width))
      }

      if (line === '') {
        line = word
      } else if (line.length + 1 + word.length <= width) {
        line += ` ${word}`
      } else {
        lines.push(line)
        line = word
      }
    }

    lines.push(line)
  }

  return lines
}

// After a compaction or a clear of the main conversation: nothing is held any more, and what is on the todo list is shown and
// handed to the model to work through.
async function afterCompact($: any) {
  await update($, isHeld, () => false)
  await update($, added, () => false) // the hand-over below covers what was added
  await refresh($)
  const items = await readList($, TODO)

  if (items.length === 0) {
    return
  }

  // Not awaited: the prompt starts a turn of its own once the session is idle, which is after this hook has returned.
  void $.prompt
    .submit({
      text: `The conversation was just compacted or cleared. Work through the todo list in ${TODO} one item at a time, and delete each item from the file as soon as it is done:\n${listing(items)}`,
    })
    .catch(() => undefined)
}

// Compacts now; false when the engine would not (a turn is still running, or a hook refused). Only ever asked for between replies:
// a quarter second after the main conversation's turn has completed, or before a prompt typed while idle enters. The engine itself
// rejects the call while a turn runs, so a reply is never compacted under way.
async function compactNow($: any) {
  const before = (await read($, meter))?.tokens ?? 0
  const done = await $.session.compact({ instructions: `Open work is listed in ${TODO}; say that it is there.` }).catch(() => undefined)

  if (done === undefined || done.skip !== undefined) {
    return false
  }

  await afterCompact($) // the engine does not run this mod's own session.compact hook for a compaction it asked for itself
  await record($, before)

  return true
}

// What Pocketbook's own compactions have spared, kept across sessions: the context before one less the context after it, which is
// the usual compacted size until the engine has measured the new one.
async function record($: any, before: number) {
  const after = (await read($, meter))?.tokens ?? COMPACTED
  const kept = await savings($)
  await $.store.set('history', { count: kept.count + 1, saved: kept.saved + Math.max(0, before - after) })
}

async function savings($: any): Promise<History> {
  return ((await $.store.get('history')) as History | undefined) ?? { count: 0, saved: 0 }
}

// The answer to a mode change, which a command prints and the footer's buttons toast.
async function changeMode($: any, picked: Mode) {
  const wasOff = (await read($, mode)) === 'off'
  await setMode($, picked)

  return modeReport(picked, wasOff, await read($, conf), await savings($))
}

// The reply that passed the hard limit has ended. With background work running the conversation is held as it is; with none it is
// compacted as soon as the turn has fully ended, or failing that before the next prompt.
async function atHardLimit($: any) {
  await update($, isHeld, () => true)
  await note($)

  if (await isBusy($)) {
    say($, HELD)
    } else {
    $.clock.after(250, () => void compactNow($))
  }
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
  $.ui.status((await read($, isHeld)) ? 'Compact limit reached: compacting once background work has ended.' : past === undefined ? undefined : softNote(past.tokens, past.limit))
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

// One line that says what a request asks, with what should not be repeated left out. With the account out of usage no model can write
// it, so it is the request's first 60 characters; a short request is kept as typed; the model's line is kept whole.
async function summarize($: any, text: string) {
  if ((await read($, usage)) >= OUT) {
    return summaryOf(text)
  }

  if (text.length <= 100 && !text.includes('\n')) {
    return scrub(text.trim())
  }

  const answer = await $.model
    .complete({
      model: 'haiku',
      maxTokens: 60,
      prompt: `Rewrite this request as one line of at most 15 words that keeps what is asked for. Leave out names of people, secrets, file contents and pasted data. Answer with the line alone.\n\n${text}`,
    })
    .catch(() => undefined)

  return (answer?.isAnswered ? scrub(oneLine(answer.text)) : '') || summaryOf(text)
}

async function addTodo($: any, text: string) {
  const items = await readList($, TODO)
  await writeList($, TODO, [...items, { summary: await summarize($, text), full: text }])

  if (await read($, isTurn)) {
    await update($, added, () => true)
  }
}

// A reply has ended with todo items added during it. With usage left the model is handed the list now; with none it waits for the
// next prompt, which carries the same word (see prompt.submit).
async function handBack($: any) {
  const items = await readList($, TODO)

  if ((await read($, usage)) >= OUT) {
    say($, 'Usage is used up. What you add stays on the todo list and is picked up with your next prompt after it resets.')
  
    return
  }

  await update($, added, () => false)
  void $.prompt.submit({ text: `Todo items were added while you worked. Work through the todo list in ${TODO} one item at a time, and delete each item from the file as soon as it is done:\n${listing(items)}` }).catch(() => undefined)
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

// Claude Code measures its own "Context low" warning against CLAUDE_CODE_AUTO_COMPACT_WINDOW when that is set. With its own auto-compact
// off the warning is red and no plugin can hide it, so the person is told where it comes from and how to move it out of the way.
async function windowNote($: any) {
  const size = await $.env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW')

  if (!size) {
    return ''
  }

  const { context } = await $.session.usage({ breakdown: 'summary' }).catch(() => ({ context: {} as { breakdown?: { isAutoCompactEnabled: boolean } } }))

  return context.breakdown?.isAutoCompactEnabled === false
    ? `Claude Code is set to measure against a ${size} window (CLAUDE_CODE_AUTO_COMPACT_WINDOW) and its own auto-compact is off, so it shows a red "Context low" warning from about 80% of that. Pocketbook cannot hide it. Remove the setting from the env block of settings.json and restart Claude Code to move the warning out to the model's full window.`
    : ''
}

// /pocketbook setup: shows what each soft limit would have saved over the person's own history, lets them pick one, and works the
// hard limits out from where their conversations went after it.
async function setup($: any, typed: string): Promise<string> {
  const days = /^\d+$/.test(typed) ? Math.max(1, Number(typed)) : 14
  const before = (await read($, conf)) ?? defaults(ceilingOf((await $.session.usage()).context.window))
  const sessions = await history($, days).catch(() => [] as number[][])
  const rows = table(sessions, before.ceiling)
  const best = suggested(rows) ?? before.soft
  const summary =
    sessions.length === 0
      ? `Found no conversations from the last ${days} days to learn from (git is needed to read them), so the choices below are not measured.`
      : [
          `Looked at ${sessions.length} conversations from the last ${days} days (${sessions.flat().length} requests).`,
          '',
          'Soft limit   Tokens saved   Conversations that reached it',
          ...rows.map(row => `${K(row.limit).padEnd(13)}${`${row.saved}%`.padEnd(15)}${row.reached}%`),
          '',
          'Tokens saved is the share of everything read that compacting at that limit would have spared, taking a compacted conversation as 30K. A lower limit saves more and interrupts more conversations.',
        ].join('\n')
  const note = await windowNote($)
  const report = note === '' ? summary : `${summary}\n\n${note}`
  // The dialog takes four choices: the suggestion and the three limits nearest it. Any other is typed under "Other".
  const others = rows
    .map(row => row.limit)
    .filter(limit => limit !== best)
    .sort((a, b) => Math.abs(a - best) - Math.abs(b - best))
    .slice(0, 3)
    .sort((a, b) => a - b)
  say($, report) // shown while the question is up; the answer below repeats it for the record
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
    ...(['lite', 'auto', 'ultra'] as const).map(one => `  ${modeLine(one, picked)}`),
    `The todo list is ${TODO}, the backlog ${BACKLOG}.`,
  ].join('\n')
}

const USAGE = `Pocketbook commands:
  setup               pick the limits from your own history
  setup -units [tokens|%]  switch the footer between tokens and percent
  mode::<name>        off, lite, auto or ultra
  details -todo|-backlog <n>  show the whole request of an item
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

    return changeMode($, picked)
  }

  if (word === 'setup' && restWords[0] === '-units') {
    const asked = restWords[1] === undefined ? undefined : restWords[1] === '%' ? 'percent' : restWords[1]
    const next = asked === 'tokens' || asked === 'percent' ? asked : (await read($, units)) === 'tokens' ? 'percent' : 'tokens'

    await $.store.set('units', next)
    await update($, units, () => next)

    return `The footer now shows ${next}.`
  }

  if (word === 'setup') {
    return setup($, rest)
  }

  if (word === 'details') {
    const list = restWords[0] === '-todo' ? 'TODO' : restWords[0] === '-backlog' ? 'BACKLOG' : undefined

    if (list === undefined) {
      return 'Say which list: details -todo <n> or details -backlog <n>.'
    }

    const kept = await readList($, list === 'TODO' ? TODO : BACKLOG)
    const at = pick(kept, restWords[1] ?? '')

    if (at === undefined) {
      return kept.length === 0 ? `The ${list.toLowerCase()} list is empty.` : `Give the number of an item, 1 to ${kept.length}.`
    }

    await showDetail($, list, at + 1)

    return ''
  }

  if (word === 'backlog') {
    await showList($)

    return ''
  }

  const items = await readList($, TODO)

  if (word === 'todo' && rest === '') {
    await showList($)

    return ''
  }

  if (word === 'todo' && restWords[0] === '-add') {
    const text = rest.slice('-add'.length).trim()

    if (text === '') {
      return 'Nothing to add: write the task after -add.'
    }

    await addTodo($, text)

    await showList($)

    return 'Added.'
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

    const left = items.filter((_, i) => i !== at)
    await writeList($, TODO, left)

    await showList($)

    return `${isRemove ? 'Removed' : 'Moved to the backlog'}: ${items[at]!.summary}`
  }

  if (word === 'archive') {
    if (items.length === 0) {
      return 'The todo list is empty.'
    }

    await writeList($, BACKLOG, [...(await readList($, BACKLOG)), ...items])
    await writeList($, TODO, [])

    await showList($)

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
  const unit = (await $.store.get('units')) === 'percent' ? 'percent' : 'tokens'
  await update($, units, () => unit)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'pocketbook', description: 'Context limits, modes, and the todo list', argumentHint: '[setup | mode::<name> | todo | todo -add <text> | todo -remove <n> | stash <n> | archive | backlog | details -todo|-backlog <n>]' })
    await loadConf($)
    await update($, isTurn, () => false)
    // Pocketbook compacts by its own limits, so Claude Code's own automatic compaction is turned off; a refusal (a managed setting) is left be.
    await $.config.set({ key: 'autoCompact', value: false }).catch(() => undefined)
    await refresh($)

    return result
  })

  // A /clear ends the conversation without starting a session, so what follows a compaction follows it here.
  on('turn.start', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await update($, isTurn, () => true)
    }

    return result
  })

  // Pushed when a rate-limit window moves a whole point. Near the end of one the todo list is shown once, so the person knows
  // /pocketbook todo -add keeps working after it runs out, when the model answers nothing.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await update($, usage, () => Math.max(0, ...e.rateLimits.map(limit => limit.percentUsed)))
    const seen = await read($, warned)
    const near = e.rateLimits.filter(limit => limit.percentUsed >= NEAR && !seen.includes(`${limit.kind}:${limit.resetsAt}`))

    if (near.length > 0) {
      await update($, warned, ids => [...ids, ...near.map(limit => `${limit.kind}:${limit.resetsAt}`)])
      const worst = near.reduce((a, b) => (b.percentUsed > a.percentUsed ? b : a))
      say($, `Usage is at ${Math.round(worst.percentUsed)}% of the ${worst.kind.replace('_', '-')} limit. /pocketbook todo -add keeps working when it runs out; what you add waits on the list.`)
        }

    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const result = await next(e)

    if (e.reason === 'clear') {
      await update($, shells, () => [])
      await afterCompact($)
    }

    return result
  })

  on('command.run', { command: 'pocketbook' }, async ($, e) => {
    const text = await run($, e.args.trim())

    return text === '' ? {} : { text } // a list command answers with the toast alone
  })

  // Past the soft limit the model reads the rule beside every prompt, so it is always measured against the room left now.
  // While held, what the person types is not answered: it is kept on the todo list and they are told why. A failure here lets the prompt through.
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    const from = e.origin?.kind ?? 'composer' // a prompt with no origin is the person's own

    if (from === 'task-notification') {
      await update($, shells, ids => ids.filter(id => !text.includes(id)))
    } else if (/^force:/i.test(text)) {
      await update($, shells, () => []) // the way out when a shell is wrongly counted as running
    } else if (
      from === 'composer' &&
      text.toLowerCase() !== 'stop' &&
      !(e.command !== undefined && FREE.includes(e.command.name)) &&
      (await read($, isHeld))
    ) {
      if (await isBusy($)) {
        if (e.command === undefined) {
          await addTodo($, e.text)
        }

      
        return { drop: HELD }
      }

      // The background work ended without a word: compact first, then answer. Never for a prompt typed over a running reply
      // (`turnId`): that reply is compacted when it ends.
      if (e.turnId === undefined) {
        await compactNow($)
      }
    }

    const past = e.command === undefined ? await pastSoft($) : undefined
    const extra: string[] = []

    if (past !== undefined) {
      extra.push(rule(past.tokens, past.limit, TODO))
    }

    if (e.command === undefined && from === 'composer' && (await read($, added))) {
      await update($, added, () => false)
      extra.push(`Pocketbook: todo items were added while you worked. After this request, work through the todo list in ${TODO} one item at a time and delete each as it is done.`)
    }

    return next(extra.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...extra] })
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const started = e.tool === 'Bash' ? ((result as { result?: { backgroundTaskId?: string } }).result?.backgroundTaskId ?? '') : ''
    const stopped = e.tool === 'TaskStop' ? (e.task_id ?? e.shell_id ?? '') : ''

    if (started !== '' || stopped !== '') {
      await update($, shells, ids => (started !== '' ? [...ids, started] : ids.filter(id => id !== stopped)))
    }

    await refresh($)

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    if (e.agentId === undefined) {
      await update($, isTurn, () => false)

      if (await pastHard($)) {
        await atHardLimit($)
      } else if (await read($, added)) {
        await handBack($)
      }
    }

    return result
  })

  on('session.compact', async ($, e, next) => {
    const isMain = e.agentId === undefined

    // An automatic compaction waits as Pocketbook's own does while background work runs; one the person asks for never waits.
    if (isMain && e.trigger === 'auto' && (await read($, isHeld)) && (await isBusy($))) {
      return { skip: 'Pocketbook is waiting for background work to end before compacting.' }
    }

    const result = await next(e)

    if (isMain && result.skip === undefined && (e.trigger === 'manual' || e.trigger === 'auto')) {
      await afterCompact($)
    } else {
      await refresh($)
    }

    return result
  })

  // The list pane: the todo list on the top half, the backlog on the bottom, each with its own title, arrows and page. A title sits
  // between rules that fill the width, then each summary from the left with its number at the right edge, on the item's first line; a
  // long summary wraps under itself. It follows the pane's width, so it needs no padding. A pane drawn inline has about a third of the
  // terminal's height and does not scroll, so what is too long is paged with arrows. The engine draws the close mark. After
  // `details`, the pane holds one item's whole request instead, under the title "TODO #n" or "BACKLOG #n".
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    await read($, rev)
    // The pane says how many rows and columns its body has, docked or inline; the fallbacks are an inline pane of a third of the screen.
    const props = e.props as { scroll?: { bodyRows?: number }; bodyColumns?: number } | undefined
    const bodyRows = props?.scroll?.bodyRows ?? Math.floor((e.viewport?.rows ?? 24) / 3) - 2
    const wide = Math.max(20, (props?.bodyColumns ?? e.viewport?.columns ?? 80) - 5) // the width of a summary, after the number

    const rule = (title: string, tail: unknown) => (
      <Box key={`rule:${title}`}>
        <Box width={0} flexGrow={1} height={1} overflow="hidden">
          <Text dimColor>{'-'.repeat(300)}</Text>
        </Box>
        <Text bold>{` ${title} `}</Text>
        <Box width={0} flexGrow={1} height={1} overflow="hidden">
          <Text dimColor>{'-'.repeat(300)}</Text>
        </Box>
        {tail}
      </Box>
    )

    const one = await read($, detail)

    if (one !== null) {
      const items = await readList($, one.list === 'TODO' ? TODO : BACKLOG)
      const lines = items[one.n - 1] === undefined ? ['That item is no longer on the list.'] : wrapText(items[one.n - 1]!.full, wide + 5)
      const room = Math.max(3, bodyRows - 1)
      const start = Math.min(await read($, topDetail), Math.max(0, lines.length - 1))
      const end = Math.min(lines.length, start + room)

      return (
        <Box flexDirection="column">
          {rule(
            `${one.list} #${one.n}`,
            <Box>
              {start > 0 && (
                <Button key="up" plain onPress={() => void update($, topDetail, () => Math.max(0, start - room))}>
                  <Text dimColor> [▲]</Text>
                </Button>
              )}
              {end < lines.length && (
                <Button key="down" plain onPress={() => void update($, topDetail, () => end)}>
                  <Text dimColor> [▼]</Text>
                </Button>
              )}
              <Button key="back" plain onPress={() => void showList($)}>
                <Text dimColor> [back]</Text>
              </Button>
            </Box>,
          )}
          {lines.slice(start, end).map((line, i) => (
            <Text key={`${start + i}`}>{line === '' ? ' ' : line}</Text>
          ))}
        </Box>
      )
    }

    const half = Math.max(2, Math.floor((bodyRows - 2) / 2)) // item lines per half

    const part = async (title: 'TODO' | 'BACKLOG', path: string) => {
      const items = await readList($, path)
      const lines = (i: number) => Math.max(1, Math.ceil(items[i]!.summary.length / wide))
      const first = title === 'TODO' ? await read($, topTodo) : await read($, topBacklog)
      const start = Math.min(first, Math.max(0, items.length - 1))
      const go = (n: number) => void (title === 'TODO' ? update($, topTodo, () => n) : update($, topBacklog, () => n))
      let end = start
      let used = 0

      while (end < items.length && (end === start || used + lines(end) <= half)) {
        used += lines(end)
        end += 1
      }

      return (
        <Box key={title} flexDirection="column">
          {rule(
            title,
            <Box>
              {start > 0 && (
                <Button key={`up:${title}`} plain onPress={() => go(Math.max(0, start - Math.max(1, end - start)))}>
                  <Text dimColor> [▲]</Text>
                </Button>
              )}
              {end < items.length && (
                <Button key={`down:${title}`} plain onPress={() => go(end)}>
                  <Text dimColor> [▼]</Text>
                </Button>
              )}
            </Box>,
          )}
          {items.length === 0 && <Text dimColor>The list is empty.</Text>}
          {items.slice(start, end).map((item, i) => (
            <Box key={`${start + i}:${item.summary}`} gap={1}>
              <Box flexGrow={1} flexShrink={1}>
                <Text>{item.summary}</Text>
              </Box>
              <Text dimColor>{`[${start + i + 1}]`}</Text>
            </Box>
          ))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {await part('TODO', TODO)}
        {await part('BACKLOG', BACKLOG)}
      </Box>
    )
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
    const unit = (await read($, units)) === 'percent' ? 'percent' : 'tokens'
    const { Box, Button, Text } = $.ui.resolve(e)

    if (await read($, isModesOpen)) {
      return (
        <Box gap={1}>
          {await next(e)}
          {MODES.map(one => (
            <Button key={`mode:${one}`} plain onPress={() => void changeMode($, one).then(text => say($, text))}>
              {one === current ? <Text color={modeColor(one, name as 'high' | 'medium' | 'low')}>{`[ ${one} ]`}</Text> : <Text dimColor>{one}</Text>}
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
        <Text>{unit === 'percent' ? `~${usedText(m.tokens, shown, unit)}` : `~${K(m.tokens)} tokens of ${K(shown)} tokens`}</Text>
      ) : (
        <Text color={color}>{`Context ${name} (${usedText(m.tokens, shown, unit)})`}</Text>
      )

    return (
      <Box gap={1}>
        {await next(e)}
        {size}
        <Button key="mode" plain onPress={() => update($, isModesOpen, () => true)}>
          <Text color={color}>●</Text> <Text>{current}</Text>
        </Button>
        <Button key="show" plain onPress={() => void showList($)}>
          <Text dimColor>show</Text>
        </Button>
      </Box>
    )
  })
}
