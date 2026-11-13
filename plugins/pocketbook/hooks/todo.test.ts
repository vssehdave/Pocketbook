import { expect, test } from 'claude-code/testing'

import { listing, parse, pick, serialize, summaryOf, toastText } from './todo'

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

test('the fallback summary is the first line that says something, cut to 60 characters', () => {
  expect(summaryOf('\n  do   this\nand that')).toBe('do this')
  expect(summaryOf('x'.repeat(150))).toHaveLength(60)
})

test('items are listed with their numbers, and a number names an item', () => {
  expect(listing(ITEMS)).toBe('Rewrite the importer [1]\nFix the typo [2]')
  expect(pick(ITEMS, '2')).toBe(1)
  expect([pick(ITEMS, '0'), pick(ITEMS, '3'), pick(ITEMS, 'two')]).toEqual([undefined, undefined, undefined])
})

test('the toast centres its title and ends each number at the right edge, on the first line of a wrapped item', () => {
  const items = [
    { summary: 'Rewrite the importer to stream rows', full: '' },
    { summary: 'Add retries to the upload step and log each failed attempt', full: '' },
    ...Array.from({ length: 8 }, (_, i) => ({ summary: `item ${i + 3}`, full: '' })),
  ]
  const rows = toastText('TODO', items, 40).split('\n')

  expect(rows[0]).toBe(`${'-'.repeat(17)} TODO ${'-'.repeat(17)}`)
  expect(rows[1]).toBe('Rewrite the importer to stream rows [1]'.replace(' [1]', '  [1]'))
  expect(rows[2]).toBe('Add retries to the upload step and   [2]')
  expect(rows[3]).toBe('log each failed attempt')
  expect(rows.every(row => row.length <= 40)).toBe(true)
  expect(rows.at(-1)).toBe(`item 10${' '.repeat(29)}[10]`)
  expect(toastText('BACKLOG', [], 40)).toBe(`${'-'.repeat(15)} BACKLOG ${'-'.repeat(16)}\nThe list is empty.`)
})

test('a word longer than the toast is cut rather than overflowing it', () => {
  const rows = toastText('TODO', [{ summary: 'x'.repeat(50), full: '' }], 40).split('\n')

  expect(rows.slice(1).every(row => row.length <= 40)).toBe(true)
  expect(rows[1]).toMatch(/^x+ +\[1\]$/)
})
