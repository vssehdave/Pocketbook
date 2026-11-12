// The last context size the session reported, in tokens; null until the first reply of a fresh or just-compacted conversation.
export type Meter = { tokens: number } | null

declare module 'claude-code' {
  interface PluginState {
    'context-meter': { meter: Meter }
  }
}
