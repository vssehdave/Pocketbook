import { expect, test } from 'claude-code/testing'

import { handOver, listing, parse, pick, serialize, summaryOf } from './todo'

const ITEMS = [
  { summary: 'Rewrite the importer', full: 'Rewrite the importer so it streams.\nKeep the old flags.' },
  { summary: 'Fix the typo', full: 'Fix the typo' },
]

test('a list survives being written and read back', () => {
  const text = serialize('Pocketbook todo', ITEMS)

  expect(text).toBe('# Pocketbook todo\n\n- Rewrite the importer\n  Rewrite the importer so it streams.\n  Keep the old flags.\n- Fix the typo\n')
  expect(parse(text)).toEqual(ITEMS)
  expect(parse(text.replace(/\n/g, '\r\n'))).toEqual(ITEMS)
})

test('a file with no items is an empty list', () => {
  expect(parse('# Pocketbook todo\n\n')).toEqual([])
})

test('the fallback summary is the first line that says something, cut to 60 characters and dots', () => {
  expect(summaryOf('\n  do   this\nand that')).toBe('do this')
  expect(summaryOf('word '.repeat(40))).toBe(`${'word '.repeat(11)}word...`) // 59 characters and the dots
  expect(summaryOf('use sk-test-FAKE-0000-1111 and mail a.b@example.com')).toBe('use [key] and mail [email]')
})

test('items are listed with their numbers, and a number names an item', () => {
  expect(listing(ITEMS)).toBe('Rewrite the importer [1]\nFix the typo [2]')
  expect(pick(ITEMS, '2')).toBe(1)
  expect([pick(ITEMS, '0'), pick(ITEMS, '3'), pick(ITEMS, 'two')]).toEqual([undefined, undefined, undefined])
})

test('the hand-over tells the model to read each full request in the file', () => {
  const text = handOver('Start now.', ITEMS)

  expect(text).toContain('one item at a time')
  expect(text).toContain('full request is under it in the file')
  expect(text.endsWith(listing(ITEMS))).toBe(true)
})
