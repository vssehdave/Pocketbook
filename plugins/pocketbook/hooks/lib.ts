import type { Conf, Mode } from '../types'

// 123456 reads "123K".
export const K = (tokens: number) => `${Math.round(tokens / 1000)}K`

const STEP = 25_000

// Bands of what is left: 70% or more is high, 35 to 69 medium, under 35 low.
export const band = (left: number) =>
  left >= 70
    ? { name: 'high', color: 'green' }
    : left >= 35
      ? { name: 'medium', color: 'yellow' }
      : { name: 'low', color: 'red' }

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
