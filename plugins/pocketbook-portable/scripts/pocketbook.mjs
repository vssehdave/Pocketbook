#!/usr/bin/env node
// Pocketbook for agents without a plugin API of Claude Code's kind: the bookmark list and the shelf, and the hooks that keep them
// working. No dependencies. The lists are the same markdown files the Claude Code plugin writes, in .pocketbook/ of the project.
//
//   node pocketbook.mjs bookmark | bookmark -add <text> | shelf | details b<n>|s<n> | edit b<n>|s<n> <text> | remove b<n>|s<n>
//                        remove b|s -all | push b<n> | push -all | pop s<n> | pop -all
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

export const listing = (items, letter = 'b') => items.map((item, at) => `${item.summary} [${letter}${at + 1}]`).join('\n')

// What the person is shown after a change: the bookmark list as it now stands.
const shown = items => (items.length === 0 ? 'The bookmark list is empty.' : `The bookmark list:\n${listing(items)}`)

const pick = (items, typed) => {
  const at = /^\d+$/.test(typed) ? Number(typed) - 1 : -1

  return at >= 0 && at < items.length ? at : undefined
}

// The files the lists had before they were renamed: read when the new file is not there yet, so nobody's list is lost.
const LEGACY = { 'bookmark.md': 'todo.md', 'shelf.md': 'backlog.md' }
const read = (cwd, name) => {
  const file = existsSync(join(cwd, DIR, name)) ? name : LEGACY[name]

  return file !== undefined && existsSync(join(cwd, DIR, file)) ? readFileSync(join(cwd, DIR, file), 'utf8') : ''
}

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
const save = (cwd, name, items) => write(cwd, name, serialize(name === 'bookmark.md' ? 'Pocketbook bookmark' : 'Pocketbook shelf', items))

// When the person last sent a prompt, and when something was last added to the bookmark list: an add after the prompt was made while the
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
  bookmark                show the bookmark list
  bookmark -add <text>    add to it
  shelf             show the shelf
  details b<n>|s<n>   show the whole request of an item
  edit b<n>|s<n> <text>  rewrite an item
  remove b<n>|s<n>    remove an item
  remove b|s -all     remove every item from the bookmark list (b) or the shelf (s)
  push b<n>           put a bookmark item on the shelf
  push -all           put the whole bookmark list on the shelf
  pop s<n>            bring a shelf item back to the bookmark list
  pop -all            bring the whole shelf back
  Items are named by their list and place: b3 is the third bookmark item, s2 the second shelf item.`

const NAMED = 'Name the item by its list and number: b<n> for the bookmark list, s<n> for the shelf.'

// What the command answers for the words typed after it.
export function run(cwd, args) {
  const [word = '', ...words] = args.trim().split(/\s+/)
  const rest = args.trim().slice(word.length).trim()
  const items = list(cwd, 'bookmark.md')
  const stored = list(cwd, 'shelf.md')

  // The item the first word names, b3 or s2: its list, its place, or what to say when it is none.
  const find = () => {
    const ref = /^([bs])(\d+)$/i.exec(words[0] ?? '')

    if (ref === null) {
      return { said: NAMED }
    }

    const isBookmark = ref[1].toLowerCase() === 'b'
    const kept = isBookmark ? items : stored
    const at = pick(kept, ref[2])

    if (at === undefined) {
      return { said: kept.length === 0 ? `The ${isBookmark ? 'bookmark list' : 'shelf'} is empty.` : `Give the number of an item, 1 to ${kept.length}.` }
    }

    return { isBookmark, kept, at, file: isBookmark ? 'bookmark.md' : 'shelf.md' }
  }

  if (word === 'details' || word === 'edit' || word === 'remove') {
    const whole = /^([bs])$/i.exec(words[0] ?? '')

    if (word === 'remove' && whole !== null && words[1] === '-all') {
      const isBookmark = whole[1].toLowerCase() === 'b'
      const kept = isBookmark ? items : stored

      if (kept.length === 0) {
        return `The ${isBookmark ? 'bookmark list' : 'shelf'} is empty.`
      }

      save(cwd, isBookmark ? 'bookmark.md' : 'shelf.md', [])

      return `Removed all ${kept.length} from the ${isBookmark ? 'bookmark list' : 'shelf'}.`
    }

    const found = find()

    if (found.said !== undefined) {
      return found.said
    }

    const { isBookmark, kept, at, file } = found
    const tag = words[0].toLowerCase()

    if (word === 'details') {
      return `${isBookmark ? 'BOOKMARK' : 'SHELF'} #${at + 1}\n${kept[at].full}`
    }

    if (word === 'remove') {
      save(cwd, file, kept.filter((_, i) => i !== at))

      return `Removed: ${kept[at].summary}${isBookmark ? `\n${shown(list(cwd, 'bookmark.md'))}` : ''}`
    }

    const text = rest.slice(words[0].length).trim()

    if (text === '') {
      return `${isBookmark ? 'BOOKMARK' : 'SHELF'} #${at + 1}\n${kept[at].full}\nType: edit ${tag} <new text>`
    }

    save(cwd, file, kept.map((item, i) => (i === at ? { summary: summaryOf(text), full: text } : item)))

    return 'Edited.'
  }

  // push puts a bookmark item on the shelf shelf, pop takes one back off it; with -all they move the whole list.
  if (word === 'push' || word === 'pop') {
    const isPush = word === 'push'
    const [from, to, fromFile, toFile] = isPush ? [items, stored, 'bookmark.md', 'shelf.md'] : [stored, items, 'shelf.md', 'bookmark.md']

    if (rest === '-all') {
      if (from.length === 0) {
        return `The ${isPush ? 'bookmark list' : 'shelf'} is empty.`
      }

      save(cwd, toFile, [...to, ...from])
      save(cwd, fromFile, [])

      return `Moved ${from.length} to the ${isPush ? 'shelf' : 'bookmark list'}.\n${shown(list(cwd, 'bookmark.md'))}`
    }

    const found = find()

    if (found.said !== undefined) {
      return found.said
    }

    if (found.isBookmark !== isPush) {
      return isPush ? 'push moves a bookmark item to the shelf: push b<n>, or push -all.' : 'pop brings a shelf item back to the bookmark list: pop s<n>, or pop -all.'
    }

    save(cwd, toFile, [...to, found.kept[found.at]])
    save(cwd, fromFile, found.kept.filter((_, i) => i !== found.at))

    return `Moved to the ${isPush ? 'shelf' : 'bookmark list'}: ${found.kept[found.at].summary}\n${shown(list(cwd, 'bookmark.md'))}`
  }

  if (word === 'shelf' && rest === '') {
    return listing(stored, 's') || 'The shelf is empty.'
  }

  if (word === 'bookmark' && rest === '') {
    return listing(items) || 'The bookmark list is empty.'
  }

  if (word === 'bookmark' && words[0] === '-add') {
    const text = rest.slice('-add'.length).trim()

    if (text === '') {
      return 'Nothing to add: write the task after -add.'
    }

    save(cwd, 'bookmark.md', [...items, { summary: summaryOf(text), full: text }])
    mark(cwd, 'added')

    return `Added. ${shown(list(cwd, 'bookmark.md'))}`
  }

  return USAGE
}

// "pb bookmark -add fix the footer" is a Pocketbook command typed as a prompt. The word after pb has to be a command, so a prompt that
// merely starts with "pb" goes through untouched.
const TYPED = /^\s*pb\s+((?:bookmark|shelf|push|pop|details|edit|remove)\b[\s\S]*)$/i

// Each agent words "block this" and "add this context" its own way.
const block = (agent, text) => ({ decision: agent === 'gemini' ? 'deny' : 'block', reason: text, systemMessage: text })
const context = (agent, text) =>
  agent === 'codex'
    ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }
    : agent === 'gemini'
      ? { hookSpecificOutput: { hookEventName: 'BeforeAgent', additionalContext: text } }
      : undefined // Copilot's command hooks cannot add to a prompt

const FOLLOW = file => `Work through the bookmark list one item at a time, and when an item is done run: node "${file}" remove b<n>`

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
    return added > turn && list(cwd, 'bookmark.md').length > 0
      ? context(agent, `Pocketbook: bookmark items were added while you worked. After this request, work through the bookmark list in ${DIR}/bookmark.md. ${FOLLOW(file)}`)
      : undefined
  }

  // The reply is over. Bookmark items added during it are handed to the agent now; stop_hook_active keeps this from looping.
  const { added = 0, turn = 0 } = state(cwd)
  const items = list(cwd, 'bookmark.md')

  if (input.stop_hook_active || added <= turn || items.length === 0) {
    return undefined
  }

  mark(cwd, 'turn')

  return { decision: agent === 'gemini' ? 'deny' : 'block', reason: `Bookmark items were added while you worked. ${FOLLOW(file)}\n${listing(items)}` }
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
