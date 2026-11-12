#!/usr/bin/env node
// Pocketbook for agents without a plugin API of Claude Code's kind: the todo list and the backlog, and the hooks that keep them
// working. No dependencies. The lists are the same markdown files the Claude Code plugin writes, in .pocketbook/ of the project.
//
//   node pocketbook.mjs todo | todo -add <text> | todo -remove <n> | stash <n> | archive | backlog
//   node pocketbook.mjs hook <prompt|stop> <codex|gemini|copilot>     (reads the agent's hook JSON on stdin)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = '.pocketbook'

// A list file is markdown: each item a "- summary" line, the full request under it on lines indented by two spaces.
export const parse = text => {
  const items = []

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('- ')) {
      items.push({ summary: line.slice(2).trim(), body: [] })
    } else if (line.startsWith('  ') && items.length > 0) {
      items.at(-1).body.push(line.slice(2))
    }
  }

  return items.map(({ summary, body }) => ({ summary, full: body.length > 0 ? body.join('\n') : summary }))
}

export const serialize = (title, items) =>
  `# ${title}\n\n` + items.map(({ summary, full }) => (full === summary ? `- ${summary}\n` : `- ${summary}\n${full.replace(/^/gm, '  ')}\n`)).join('')

// No model writes the summary here: it is the first line that says something, cut to 100 characters.
export const summaryOf = text => {
  const line = (text.split(/\r?\n/).find(one => one.trim() !== '') ?? '').trim().replace(/\s+/g, ' ')

  return line.length > 100 ? `${line.slice(0, 99)}…` : line
}

export const listing = items => items.map((item, at) => `${item.summary} [${at + 1}]`).join('\n')

const pick = (items, typed) => {
  const at = /^\d+$/.test(typed) ? Number(typed) - 1 : -1

  return at >= 0 && at < items.length ? at : undefined
}

const read = (cwd, name) => (existsSync(join(cwd, DIR, name)) ? readFileSync(join(cwd, DIR, name), 'utf8') : '')

function write(cwd, name, text) {
  mkdirSync(join(cwd, DIR), { recursive: true })
  writeFileSync(join(cwd, DIR, name), text)
  // The lists are the person's notes, not the project's: kept out of git wherever there is a repository.
  const ignore = join(cwd, '.gitignore')
  const ignored = existsSync(ignore) ? readFileSync(ignore, 'utf8') : undefined

  if (ignored === undefined ? existsSync(join(cwd, '.git')) : !/^\.pocketbook\/?$/m.test(ignored)) {
    writeFileSync(ignore, `${ignored === undefined || ignored === '' || ignored.endsWith('\n') ? (ignored ?? '') : `${ignored}\n`}.pocketbook/\n`)
  }
}

const list = (cwd, name) => parse(read(cwd, name))
const save = (cwd, name, items) => write(cwd, name, serialize(name === 'todo.md' ? 'Pocketbook todo' : 'Pocketbook backlog', items))

// When the person last sent a prompt, and when something was last added to the todo list: an add after the prompt was made while the
// agent was answering it. A tick keeps two marks made in the same millisecond in order.
const state = cwd => {
  try {
    return JSON.parse(read(cwd, 'state.json') || '{}')
  } catch {
    return {}
  }
}
let last = 0
const tick = () => (last = Math.max(Date.now(), last + 1))
const mark = (cwd, key) => write(cwd, 'state.json', JSON.stringify({ ...state(cwd), [key]: tick() }))

export const USAGE = `Pocketbook commands:
  todo                show the todo list
  todo -add <text>    add to it
  todo -remove <n>    remove item n
  stash <n>           move item n to the backlog
  archive             move the whole todo list to the backlog
  backlog             show the backlog`

// What the command answers for the words typed after it.
export function run(cwd, args) {
  const [word = '', ...words] = args.trim().split(/\s+/)
  const rest = args.trim().slice(word.length).trim()
  const items = list(cwd, 'todo.md')

  if (word === 'backlog') {
    return listing(list(cwd, 'backlog.md')) || 'The backlog is empty.'
  }

  if (word === 'todo' && rest === '') {
    return listing(items) || 'The todo list is empty.'
  }

  if (word === 'todo' && words[0] === '-add') {
    const text = rest.slice('-add'.length).trim()

    if (text === '') {
      return 'Nothing to add: write the task after -add.'
    }

    save(cwd, 'todo.md', [...items, { summary: summaryOf(text), full: text }])
    mark(cwd, 'added')

    return `Added. The todo list:\n${listing(list(cwd, 'todo.md'))}`
  }

  const isRemove = word === 'todo' && words[0] === '-remove'

  if (isRemove || word === 'stash') {
    const at = pick(items, isRemove ? (words[1] ?? '') : rest)

    if (at === undefined) {
      return items.length === 0 ? 'The todo list is empty.' : `Give the number of an item, 1 to ${items.length}.`
    }

    if (!isRemove) {
      save(cwd, 'backlog.md', [...list(cwd, 'backlog.md'), items[at]])
    }

    save(cwd, 'todo.md', items.filter((_, i) => i !== at))

    return `${isRemove ? 'Removed' : 'Moved to the backlog'}: ${items[at].summary}`
  }

  if (word === 'archive') {
    if (items.length === 0) {
      return 'The todo list is empty.'
    }

    save(cwd, 'backlog.md', [...list(cwd, 'backlog.md'), ...items])
    save(cwd, 'todo.md', [])

    return `Moved ${items.length} to the backlog.`
  }

  return USAGE
}

// "pb todo -add fix the footer" is a Pocketbook command typed as a prompt. The word after pb has to be a command, so a prompt that
// merely starts with "pb" goes through untouched.
const TYPED = /^\s*pb\s+((?:todo|stash|archive|backlog)\b[\s\S]*)$/i

// Each agent words "block this" and "add this context" its own way.
const block = (agent, text) => ({ decision: agent === 'gemini' ? 'deny' : 'block', reason: text, systemMessage: text })
const context = (agent, text) =>
  agent === 'codex'
    ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }
    : agent === 'gemini'
      ? { hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: text } }
      : undefined // Copilot's command hooks cannot add to a prompt

const FOLLOW = file => `Work through the todo list one item at a time, and when an item is done run: node "${file}" todo -remove <n>`

// A hook's answer for what the agent sent on stdin; undefined says nothing.
export function hook(cwd, kind, agent, input, file) {
  if (kind === 'prompt') {
    const typed = TYPED.exec(input.prompt ?? '')

    if (typed) {
      return block(agent, run(cwd, typed[1]))
    }

    const { added = 0, turn = 0 } = state(cwd)
    mark(cwd, 'turn')

    // Added while the last reply was being answered and never handed back (usage ran out first): this prompt carries the word.
    return added > turn && list(cwd, 'todo.md').length > 0
      ? context(agent, `Pocketbook: todo items were added while you worked. After this request, work through the todo list in ${DIR}/todo.md. ${FOLLOW(file)}`)
      : undefined
  }

  // The reply is over. Todo items added during it are handed to the agent now; stop_hook_active keeps this from looping.
  const { added = 0, turn = 0 } = state(cwd)
  const items = list(cwd, 'todo.md')

  if (input.stop_hook_active || added <= turn || items.length === 0) {
    return undefined
  }

  mark(cwd, 'turn')

  return { decision: agent === 'gemini' ? 'deny' : 'block', reason: `Todo items were added while you worked. ${FOLLOW(file)}\n${listing(items)}` }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [first, ...rest] = process.argv.slice(2)

  if (first === 'hook') {
    let input = {}

    try {
      input = JSON.parse(readFileSync(0, 'utf8') || '{}')
    } catch {
      // a hook that cannot read its input lets the prompt through
    }

    const answer = hook(input.cwd ?? process.cwd(), rest[0], rest[1] ?? 'codex', input, process.argv[1])

    if (answer !== undefined) {
      process.stdout.write(`${JSON.stringify(answer)}\n`)
    }
  } else {
    console.log(run(process.cwd(), [first, ...rest].join(' ')))
  }
}
