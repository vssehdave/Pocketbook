import { expect, test } from 'claude-code/testing'

import { confFor, hardLimit, sizesOf, suggested, table, tokensIn } from './analysis'

test('request sizes are read from git grep output, once per reply, without subagents', () => {
  const out = [
    'p/a.jsonl:3:"id":"msg_1"',
    'p/a.jsonl:3:"input_tokens":2',
    'p/a.jsonl:3:"cache_creation_input_tokens":1000',
    'p/a.jsonl:3:"cache_read_input_tokens":50000',
    'p/a.jsonl:3:"input_tokens":9', // the same row repeating its counts
    'p/a.jsonl:4:"id":"msg_1"', // the same reply, stored again
    'p/a.jsonl:4:"input_tokens":2',
    'p/a.jsonl:5:"isSidechain":true', // a subagent's request
    'p/a.jsonl:5:"id":"msg_2"',
    'p/a.jsonl:5:"input_tokens":700',
    'p/a.jsonl:6:"id":"msg_3"',
    'p/a.jsonl:6:"input_tokens":60000',
    'C:\\x\\b.jsonl:1:"id":"msg_1"',
    'C:\\x\\b.jsonl:1:"input_tokens":5',
    '',
  ].join('\r\n')

  expect([...sizesOf(out)]).toEqual([
    ['p/a.jsonl', [51_002, 60_000]],
    ['C:\\x\\b.jsonl', [5]],
  ])
})

// Four conversations: one small, one that passes 150K, two that pass 200K.
const SESSIONS = [[50_000, 100_000], [100_000, 160_000], [150_000, 210_000, 240_000], [220_000, 290_000, 20_000]]

test('the table gives, per limit, the share of tokens compacting there would have spared and of conversations that reached it', () => {
  expect(table(SESSIONS, 300_000)).toEqual([
    { limit: 150_000, saved: 47, reached: 75 },
    { limit: 200_000, saved: 44, reached: 50 },
    { limit: 250_000, saved: 14, reached: 25 },
  ])
  expect(table([], 300_000).map(row => row.saved)).toEqual([0, 0, 0])
  expect(table(SESSIONS, 150_000)).toEqual([])
})

test('the suggestion is the lowest limit at most a quarter of conversations reach', () => {
  expect(suggested(table(SESSIONS, 300_000))).toBe(250_000)
  expect(suggested(table(SESSIONS, 250_000))).toBe(200_000) // none qualifies: the highest
  expect(suggested([])).toBeUndefined()
})

test('the hard limit is where 80% of conversations past the soft limit peaked, kept between soft + 25K and the ceiling', () => {
  expect(hardLimit(SESSIONS, 150_000, 400_000)).toEqual({ hard: 300_000, passed: 3 }) // peaks 160K, 240K, 290K
  expect(hardLimit(SESSIONS, 150_000, 250_000).hard).toBe(250_000)
  expect(hardLimit([[100_000, 151_000]], 150_000, 400_000).hard).toBe(175_000)
  expect(hardLimit([], 150_000, 400_000)).toEqual({ hard: 200_000, passed: 0 })
})

test('ultra starts 50K earlier with its own hard limit, never later than auto', () => {
  expect(confFor(SESSIONS, 200_000, 400_000)).toEqual({ ceiling: 400_000, soft: 200_000, hard: 300_000, ultraSoft: 150_000, ultraHard: 300_000, isSetUp: true })
  expect(confFor([[160_000, 170_000], [210_000, 280_000]], 200_000, 400_000).ultraHard).toBe(300_000)
})

test('an answer names a number of tokens', () => {
  expect([tokensIn('200K (suggested)'), tokensIn('250'), tokensIn('175,000'), Number.isNaN(tokensIn('none'))]).toEqual([200_000, 250_000, 175_000, true])
})
