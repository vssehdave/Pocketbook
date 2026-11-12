import { expect, test } from 'claude-code/testing'

import { K, band, ceilingOf, defaults, leftOf } from './lib'

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
