import type { Conf, Mode, Units } from '../types'

// 123456 reads "123K".
export const K = (tokens: number) => `${Math.round(tokens / 1000)}K`

const STEP = 25_000

// Three shades per band: the footer's own colour (muted yellow and red), a lighter one for lite and a darker one for ultra.
const SHADES = {
  high: { light: '#a8dba8', base: 'green', dark: '#6b8e23' }, // olive
  medium: { light: '#e6d28f', base: '#cfae4f', dark: '#b8860b' }, // dark goldenrod
  low: { light: '#e5a3a0', base: '#d9544e', dark: '#9b1b30' }, // blood crimson
}

// Bands of what is left: 70% or more is high, 35 to 69 medium, under 35 low.
export const band = (left: number) => {
  const name = left >= 70 ? 'high' : left >= 35 ? 'medium' : 'low'

  return { name, color: SHADES[name].base }
}

// The colour of a mode's name when it is the chosen one: off is always grey, the others follow the footer's band.
export const modeColor = (mode: Mode, name: 'high' | 'medium' | 'low') =>
  mode === 'off' ? '#bdbdbd' : mode === 'lite' ? SHADES[name].light : mode === 'auto' ? SHADES[name].base : SHADES[name].dark

// How much is used, as the footer words it: "69K used of 300K", or "23% used" in percent.
export const usedText = (tokens: number, limit: number, units: Units) =>
  units === 'percent' ? `${Math.round((tokens / limit) * 100)}% used` : `${K(tokens)} used of ${K(limit)}`

// What is left of the limit as a whole percentage, never negative.
export const leftOf = (tokens: number, limit: number) => Math.max(0, Math.round(100 - (tokens / limit) * 100))

// The most a conversation may hold. A compaction window the person or their account set is taken as it is; with none, 80% of the
// model's window, which leaves room for the reply and for the compaction itself.
export const ceilingOf = (window: number, breakdown?: { rawMaxTokens: number; autocompactSource: string }) =>
  breakdown !== undefined && breakdown.autocompactSource !== 'auto'
    ? breakdown.rawMaxTokens
    : Math.floor((window * 0.8) / STEP) * STEP

// The limits used until /pocketbook setup has picked them from the person's own history.
export const defaults = (ceiling: number): Conf => {
  const soft = Math.round((ceiling * 0.75) / STEP) * STEP
  const ultraSoft = Math.max(100_000, soft - 50_000)

  return { ceiling, soft, hard: ceiling, ultraSoft, ultraHard: Math.max(ultraSoft + STEP, ceiling - 50_000), isSetUp: false }
}

export const MODES = ['off', 'lite', 'auto', 'ultra'] as const

export const isMode = (text: unknown): text is Mode => MODES.includes(text as Mode)

// What a mode acts on: `soft` is where the note starts and `hard` where the conversation is compacted, each absent when the mode does
// not do that; `shown` is the limit the footer measures against, auto's hard limit for the modes that never compact.
export const limitsOf = (conf: Conf, mode: Mode): { soft?: number; hard?: number; shown: number } =>
  mode === 'off'
    ? { shown: conf.hard }
    : mode === 'lite'
      ? { soft: conf.soft, shown: conf.hard }
      : mode === 'auto'
        ? { soft: conf.soft, hard: conf.hard, shown: conf.hard }
        : { soft: conf.ultraSoft, hard: conf.ultraHard, shown: conf.ultraHard }

// What the person sees in the status line once the soft limit is passed.
export const softNote = (tokens: number, limit: number) =>
  `Soft limit reached: ${K(tokens)} of ${K(limit)} used, ${K(Math.max(0, limit - tokens))} left. Small and medium tasks only; larger ones go to the todo list.`

// What the model is told beside each prompt once the soft limit is passed. It cannot be handed a task's size, so it is given the
// room left and a share of it to stay under, and where to put what does not fit.
export const rule = (tokens: number, limit: number, todo: string) => {
  const room = Math.max(0, limit - tokens)

  return `Pocketbook: this conversation holds about ${K(tokens)} tokens of a ${K(limit)} limit, so about ${K(room)} are left. Start nothing you expect to need more than a third of that: about ${K(room / 3)} tokens of reading, tool output and writing. A small or medium request: do it. A request that needs more: do not start it. Append it to ${todo} as an item (a line "- <one-line summary>", then the full request on lines indented by two spaces), tell the user it is on the todo list and will be picked up once the conversation is compacted, and stop. When you finish something that is on that list, delete its item from the file.`
}

// One mode's limits as a line: its name, then where it notes and where it compacts.
export const modeLine = (name: Mode, c: Conf) => {
  const [soft, hard] = name === 'ultra' ? [c.ultraSoft, c.ultraHard] : [c.soft, c.hard]

  return `${name.padEnd(7)}notes at ${K(soft)}, ${name === 'lite' ? 'never compacts' : `compacts at ${K(hard)}`}`
}

// What Pocketbook's own compactions have spared so far: how many, and the tokens the context shrank by in total.
export type History = { count: number; saved: number }

// The answer to a mode change. Off says what compacting has saved so far; any other mode says where it notes and compacts.
export const modeReport = (name: Mode, wasOff: boolean, c: Conf | null, h: History) =>
  name === 'off'
    ? [
        'Pocketbook is off.',
        h.count === 0
          ? 'No compactions yet, so nothing has been saved.'
          : `Compacted ${h.count} time${h.count === 1 ? '' : 's'} so far, shrinking the context by ${K(h.saved)} tokens in total.`,
      ].join('\n')
    : [`Pocketbook is ${wasOff ? 'back on' : 'on'} at ${name} mode.`, ...(c === null ? [] : [modeLine(name, c)])].join('\n')
