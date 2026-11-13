// A list file is markdown: each item a "- summary" line, the full request under it on lines indented by two spaces. An item that is
// done is deleted, so the file only ever holds what is still open.
export type Item = { summary: string; full: string }

export const TODO = '.pocketbook/todo.md'
export const BACKLOG = '.pocketbook/backlog.md'

export const parse = (text: string): Item[] => {
  const items: Array<{ summary: string; body: string[] }> = []

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('- ')) {
      items.push({ summary: line.slice(2).trim(), body: [] })
    } else if (line.startsWith('  ') && items.length > 0) {
      items[items.length - 1]!.body.push(line.slice(2))
    }
  }

  return items.map(({ summary, body }) => ({ summary, full: body.length > 0 ? body.join('\n') : summary }))
}

export const serialize = (title: string, items: readonly Item[]) =>
  `# ${title}\n\n` +
  items
    .map(({ summary, full }) => (full === summary ? `- ${summary}\n` : `- ${summary}\n${full.replace(/^/gm, '  ')}\n`))
    .join('')

// The longest a summary is: one line of a list, and what a request is cut to when no model writes its summary.
export const SUMMARY = 60

// The summary used when no model wrote one: the first line that says something, cut to SUMMARY characters.
export const summaryOf = (text: string) => {
  const line = (text.split(/\r?\n/).find(one => one.trim() !== '') ?? '').trim().replace(/\s+/g, ' ')

  return line.length > SUMMARY ? `${line.slice(0, SUMMARY - 1)}…` : line
}

// The width of the list toast in columns; a narrower terminal gets a narrower toast (see toastWidth in register.tsx).
export const TOAST_WIDTH = 40

// Words broken into lines of at most `width` characters; a word longer than a line is cut.
const wrap = (text: string, width: number) => {
  const lines: string[] = []
  let line = ''

  for (let word of text.split(/\s+/).filter(Boolean)) {
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

  return [...lines, line]
}

// The list as a toast shows it, `width` columns across: the title centred between dashes, then each summary from the left edge with
// its number ending at the right edge, on the item's first line. A long summary wraps under itself.
export const toastText = (title: string, items: readonly Item[], width = TOAST_WIDTH) => {
  const dashes = Math.max(2, width - title.length - 2)
  const head = `${'-'.repeat(Math.floor(dashes / 2))} ${title} ${'-'.repeat(Math.ceil(dashes / 2))}`

  if (items.length === 0) {
    return `${head}\nThe list is empty.`
  }

  const room = width - String(items.length).length - 3 // the widest "[n]" and a space

  const rows = items.flatMap((item, at) =>
    wrap(item.summary, room).map((line, i) => (i === 0 ? line.padEnd(width - `[${at + 1}]`.length) + `[${at + 1}]` : line)),
  )

  return [head, ...rows].join('\n')
}

// What the person is shown: each summary, then its number for `todo -remove` and `stash`.
export const listing = (items: readonly Item[]) => items.map((item, at) => `${item.summary} [${at + 1}]`).join('\n')

// What the person is shown after a change: the todo list as it now stands.
export const shown = (items: readonly Item[]) => (items.length === 0 ? 'The todo list is empty.' : `The todo list:\n${listing(items)}`)

// The item a number typed by the person names, or nothing when there is none there.
export const pick = (items: readonly Item[], typed: string) => {
  const at = /^\d+$/.test(typed) ? Number(typed) - 1 : -1

  return at >= 0 && at < items.length ? at : undefined
}
