// The last context size the session reported, in tokens; null until the first reply of a fresh or just-compacted conversation.
export type Meter = { tokens: number } | null

// The limits, in tokens. `ceiling` is the most a conversation may hold; `soft` and `hard` are auto mode's, the `ultra` pair ultra
// mode's. `isSetUp` is false while they are the defaults, true once /pocketbook setup picked them.
export type Conf = { ceiling: number; soft: number; hard: number; ultraSoft: number; ultraHard: number; isSetUp: boolean }

// off: nothing is done. lite: the soft-limit note only. auto: the note, then compaction at the hard limit. ultra: both, earlier.
export type Mode = 'off' | 'lite' | 'auto' | 'ultra'

// How the footer states the size: in tokens or as a percent of the limit.
export type Units = 'tokens' | 'percent'

declare module 'claude-code' {
  interface PluginState {
    pocketbook: { meter: Meter; conf: Conf | null; mode: Mode; units: Units; isModesOpen: boolean; shells: readonly string[]; isHeld: boolean }
  }
}
