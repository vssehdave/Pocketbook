import type { Conf } from '../types'

// What `git grep` is asked to pull out of the transcripts: the fields that give one request's context size. A transcript can be far
// larger than a mod may read, so git reads them and only these come back.
export const PATTERN =
  '"id":"msg_[A-Za-z0-9]+"|"input_tokens":[0-9]+|"cache_creation_input_tokens":[0-9]+|"cache_read_input_tokens":[0-9]+|"isSidechain":true'

const FIELD = /^(.*):(\d+):"(id|input_tokens|cache_creation_input_tokens|cache_read_input_tokens|isSidechain)":"?([^"]*)"?$/

const STEP = 25_000

// The context size of every request, in order, per transcript, from `git grep -n -o` output ("path:line:match", several matches a line).
// A request is its uncached, cache-written and cache-read input together. A subagent's requests are left out, and a reply stored in
// several rows is counted once.
export const sizesOf = (stdout: string, into: Map<string, number[]> = new Map()) => {
  const seen = new Set<string>()
  let at = ''
  let row: Record<string, string> = {}
  let path = ''

  const flush = () => {
    const id = `${path}:${row.id}`

    if (row.input_tokens !== undefined && row.isSidechain === undefined && !seen.has(id)) {
      seen.add(id)
      const sizes = into.get(path) ?? []
      sizes.push(Number(row.input_tokens) + Number(row.cache_creation_input_tokens ?? 0) + Number(row.cache_read_input_tokens ?? 0))
      into.set(path, sizes)
    }
  }

  for (const line of stdout.split(/\r?\n/)) {
    const found = FIELD.exec(line)

    if (found === null) {
      continue
    }

    if (`${found[1]}:${found[2]}` !== at) {
      flush()
      at = `${found[1]}:${found[2]}`
      path = found[1]!
      row = {}
    }

    row[found[3]!] ??= found[4]! // the first of each: a row may repeat its counts per iteration
  }

  flush()

  return into
}

export type Row = { limit: number; saved: number; reached: number }

// What a conversation is taken to hold right after a compaction: the summary and the fixed prompt. shortcut: a constant, measure it
// from the transcripts' own compactions if the table needs to be closer.
const COMPACTED = 30_000

// For each soft limit from 150K up in 50K steps, under the ceiling: `saved` is the share of all tokens read that compacting at that
// limit would have spared, and `reached` the share of conversations that got there. Both whole percentages. A request past the limit
// is counted as if each stretch of growth from the compacted size up to the limit had been cut away before it.
export const table = (sessions: readonly number[][], ceiling: number): Row[] => {
  const all = sessions.flat()
  const total = all.reduce((sum, size) => sum + size, 0)
  const rows: Row[] = []

  for (let limit = 150_000; limit < ceiling; limit += 50_000) {
    const stretch = limit - COMPACTED
    const above = all.reduce((sum, size) => (size > limit ? sum + Math.floor((size - COMPACTED) / stretch) * stretch : sum), 0)
    const reached = sessions.filter(sizes => sizes.some(size => size >= limit)).length

    rows.push({
      limit,
      saved: total === 0 ? 0 : Math.round((above / total) * 100),
      reached: sessions.length === 0 ? 0 : Math.round((reached / sessions.length) * 100),
    })
  }

  return rows
}

// The limit suggested: the lowest one that at most a quarter of conversations reach, so it saves the most without getting in the way
// of most work; the highest when every one is reached more often than that.
export const suggested = (rows: readonly Row[]) => (rows.find(row => row.reached <= 25) ?? rows.at(-1))?.limit

// Where conversations that passed the soft limit went on to peak. The hard limit is the size 80% of them stayed at or under, rounded
// up to 25K: high enough that most work past the soft limit finishes, with the spread of those peaks deciding how much higher.
// Never closer than 25K to the soft limit, never past the ceiling; with no such conversation, 50K over the soft limit.
export const hardLimit = (sessions: readonly number[][], soft: number, ceiling: number) => {
  const peaks = sessions
    .map(sizes => sizes.slice(sizes.findIndex(size => size >= soft)))
    .filter((after, at) => sessions[at]!.some(size => size >= soft) && after.length > 0)
    .map(after => Math.max(...after))
    .sort((a, b) => a - b)
  const wanted = peaks.length === 0 ? soft + 50_000 : Math.ceil(peaks[Math.ceil(peaks.length * 0.8) - 1]! / STEP) * STEP

  return { hard: Math.max(Math.min(wanted, ceiling), Math.min(soft + STEP, ceiling)), passed: peaks.length }
}

// The limits for a chosen soft limit. Ultra starts 50K earlier and gets a hard limit worked out again for that start, never later
// than auto's.
export const confFor = (sessions: readonly number[][], soft: number, ceiling: number): Conf => {
  const { hard } = hardLimit(sessions, soft, ceiling)
  const ultraSoft = Math.max(50_000, soft - 50_000)

  return { ceiling, soft, hard, ultraSoft, ultraHard: hardLimit(sessions, ultraSoft, hard).hard, isSetUp: true }
}

// The number of tokens a typed or picked answer names: "200K (suggested)", "200", "200000".
export const tokensIn = (answer: string) => {
  const found = /(\d+)/.exec(answer.replace(/[,_ ]/g, ''))
  const n = found === null ? NaN : Number(found[1])

  return n < 1000 ? n * 1000 : n
}
