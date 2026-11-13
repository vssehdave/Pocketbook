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

// What a request is cut to when the account is out of usage and no model can summarise it, before the dots that say it was cut.
export const SUMMARY = 60

// The first line of a text that says something, its spaces squeezed.
export const oneLine = (text: string) => (text.split(/\r?\n/).find(one => one.trim() !== '') ?? '').trim().replace(/\s+/g, ' ')

// Anything shaped like an email address or a key is blanked. This is a pattern, not a judgement: a password, a name or an address
// that looks like ordinary words gets through, so it is a net under the model's own redaction, not a replacement for it.
export const scrub = (line: string) =>
  line
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g, '[email]')
    .replace(/\b(?:sk|pk|ghp|gho|xox[a-z])[-_][A-Za-z0-9_-]{6,}/gi, '[key]')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[key]')

// The summary used when no model wrote one: the first line that says something, scrubbed and cut to SUMMARY characters and "...".
export const summaryOf = (text: string) => {
  const line = scrub(oneLine(text))

  return line.length > SUMMARY ? `${line.slice(0, SUMMARY).trimEnd()}...` : line
}

// Each summary and its reference (t1, t2 for the todo list), for a prompt to the model.
export const listing = (items: readonly Item[], letter = 't') => items.map((item, at) => `${item.summary} [${letter}${at + 1}]`).join('\n')

// The item a reference names: t3 the third todo item, b2 the second backlog item. Nothing when it is not one.
export const refOf = (typed: string) => {
  const ref = /^([tb])(\d+)$/i.exec(typed.trim())

  return ref === null ? undefined : { list: ref[1]!.toLowerCase() === 't' ? ('TODO' as const) : ('BACKLOG' as const), n: Number(ref[2]) }
}

// The item a number typed by the person names, or nothing when there is none there.
export const pick = (items: readonly Item[], typed: string) => {
  const at = /^\d+$/.test(typed) ? Number(typed) - 1 : -1

  return at >= 0 && at < items.length ? at : undefined
}

// What the model is handed to work from. The list shows one-line summaries, which leave out names and pasted data on purpose, so it is
// told to read the full request under each item in the file.
export const handOver = (intro: string, items: readonly Item[]) =>
  `${intro} Work through the todo list in ${TODO} one item at a time, and delete each item from the file as soon as it is done. Each item's full request is under it in the file: read it before starting, because the summary leaves things out.\n${listing(items)}`

// The one item a run hands over: the first on the list, which the person may have changed since by removing or moving items.
export const nextItem = (items: readonly Item[]) =>
  `Work on the first item on the todo list now: ${items[0]!.summary} Its full request is under it in ${TODO}: read it before starting, and delete the item from the file when it is done. Go by the file as it is now, since items can be removed at any time.`
