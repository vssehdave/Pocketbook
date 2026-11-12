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

// The summary used when no model wrote one: the first line that says something, cut to 100 characters.
export const summaryOf = (text: string) => {
  const line = (text.split(/\r?\n/).find(one => one.trim() !== '') ?? '').trim().replace(/\s+/g, ' ')

  return line.length > 100 ? `${line.slice(0, 99)}…` : line
}

// What the person is shown: each summary, then its number for `todo -remove` and `stash`.
export const listing = (items: readonly Item[]) => items.map((item, at) => `${item.summary} [${at + 1}]`).join('\n')

// The item a number typed by the person names, or nothing when there is none there.
export const pick = (items: readonly Item[], typed: string) => {
  const at = /^\d+$/.test(typed) ? Number(typed) - 1 : -1

  return at >= 0 && at < items.length ? at : undefined
}
