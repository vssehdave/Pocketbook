import { expect, test } from 'claude-code/testing'

import { K, band, ceilingOf, defaults, leftOf, limitsOf, rule, softNote } from './lib'

test('tokens read in thousands', () => {
  expect(K(123_456)).toBe('123K')
})

test('the bands turn at 70 and 35, and what is left is never negative', () => {
  expect([70, 69, 35, 34].map(left => band(left).name)).toEqual(['high', 'medium', 'medium', 'low'])
  expect(leftOf(450_000, 300_000)).toBe(0)
})

test('a compaction window someone set is the ceiling; with none, 80% of the model window', () => {
  expect(ceilingOf(1_000_000, { rawMaxTokens: 300_000, autocompactSource: 'env' })).toBe(300_000)
  expect(ceilingOf(200_000, { rawMaxTokens: 200_000, autocompactSource: 'auto' })).toBe(150_000)
  expect(ceilingOf(200_000)).toBe(150_000)
})

test('the default limits sit under the ceiling', () => {
  expect(defaults(300_000)).toEqual({ ceiling: 300_000, soft: 225_000, hard: 300_000, ultraSoft: 175_000, ultraHard: 250_000, isSetUp: false })
})

test('each mode acts on its own limits', () => {
  const conf = defaults(300_000)

  expect(limitsOf(conf, 'off')).toEqual({ shown: 300_000 })
  expect(limitsOf(conf, 'lite')).toEqual({ soft: 225_000, shown: 300_000 })
  expect(limitsOf(conf, 'auto')).toEqual({ soft: 225_000, hard: 300_000, shown: 300_000 })
  expect(limitsOf(conf, 'ultra')).toEqual({ soft: 175_000, hard: 250_000, shown: 250_000 })
})

test('past the soft limit the note and the rule give the room left and a third of it', () => {
  expect(softNote(250_000, 300_000)).toBe('Soft limit reached: 250K of 300K used, 50K left. Small and medium tasks only; larger ones go to the todo list.')
  expect(rule(250_000, 300_000, 'todo.md')).toContain('about 50K are left')
  expect(rule(250_000, 300_000, 'todo.md')).toContain('about 17K tokens')
  expect(rule(310_000, 300_000, 'todo.md')).toContain('about 0K are left')
})
