import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hook, run, summaryOf } from './pocketbook.mjs'

const dir = () => mkdtempSync(join(tmpdir(), 'pb-'))

test('the bookmark list is added to, stashed, removed from and moved whole', () => {
  const cwd = dir()
  mkdirSync(join(cwd, '.git'))

  assert.equal(run(cwd, 'bookmark'), 'The bookmark list is empty.')
  run(cwd, 'bookmark -add first task')
  run(cwd, 'bookmark -add second task')
  assert.equal(run(cwd, 'bookmark -add third task'), 'Added. The bookmark list:\nfirst task [b1]\nsecond task [b2]\nthird task [b3]')
  assert.equal(readFileSync(join(cwd, '.gitignore'), 'utf8'), '.pocketbook/\n')
  assert.equal(run(cwd, 'push b2'), 'Moved to the shelf: second task\nThe bookmark list:\nfirst task [b1]\nthird task [b2]')
  assert.equal(run(cwd, 'remove b1'), 'Removed: first task\nThe bookmark list:\nthird task [b1]')
  assert.equal(run(cwd, 'remove b5'), 'Give the number of an item, 1 to 1.')
  assert.equal(run(cwd, 'push -all'), 'Moved 1 to the shelf.\nThe bookmark list is empty.')
  assert.equal(run(cwd, 'shelf'), 'second task [s1]\nthird task [s2]')
})

test('a request of several lines keeps its first line as the summary and the whole under it', () => {
  const cwd = dir()
  run(cwd, 'bookmark -add fix the footer\nthen the colors')

  assert.equal(summaryOf('\n  fix   the footer\nmore'), 'fix the footer')
  assert.match(readFileSync(join(cwd, '.pocketbook/bookmark.md'), 'utf8'), /- fix the footer\n {2}fix the footer\n {2}then the colors/)
})

test('a prompt typed as "pb ..." is answered by the hook and not sent on', () => {
  const cwd = dir()

  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pb bookmark -add write docs' }, 'p.mjs').decision, 'block')
  assert.equal(hook(cwd, 'prompt', 'gemini', { prompt: 'PB bookmark' }, 'p.mjs').decision, 'deny')
  assert.match(hook(cwd, 'prompt', 'codex', { prompt: 'pb bookmark' }, 'p.mjs').reason, /write docs \[b1\]/)
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pbj is a word' }, 'p.mjs')?.decision, undefined)
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pb is short for pocketbook' }, 'p.mjs')?.decision, undefined)
})

test('a bookmark added during a reply is handed back when the reply ends, once', () => {
  const cwd = dir()
  hook(cwd, 'prompt', 'codex', { prompt: 'build it' }, 'p.mjs')
  hook(cwd, 'prompt', 'codex', { prompt: 'pb bookmark -add second' }, 'p.mjs')

  const stop = hook(cwd, 'stop', 'codex', {}, 'p.mjs')
  assert.equal(stop.decision, 'block')
  assert.match(stop.reason, /second \[b1\]/)
  assert.equal(hook(cwd, 'stop', 'codex', {}, 'p.mjs'), undefined)
})

test('a continued stop is left alone, and so is an empty list', () => {
  const cwd = dir()
  hook(cwd, 'prompt', 'codex', { prompt: 'build it' }, 'p.mjs')
  run(cwd, 'bookmark -add second')

  assert.equal(hook(cwd, 'stop', 'codex', { stop_hook_active: true }, 'p.mjs'), undefined)
  run(cwd, 'remove b1')
  assert.equal(hook(cwd, 'stop', 'codex', {}, 'p.mjs'), undefined)
})

test('when the reply never ended, the next prompt carries the word', () => {
  const cwd = dir()
  hook(cwd, 'prompt', 'codex', { prompt: 'build it' }, 'p.mjs')
  run(cwd, 'bookmark -add second')

  const next = hook(cwd, 'prompt', 'codex', { prompt: 'carry on' }, 'p.mjs')
  assert.match(next.hookSpecificOutput.additionalContext, /bookmark items were added while you worked/)
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'and again' }, 'p.mjs'), undefined)
})

test('a broken state file is read as empty', () => {
  const cwd = dir()
  mkdirSync(join(cwd, '.pocketbook'))
  writeFileSync(join(cwd, '.pocketbook/state.json'), '{nope')

  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'hello' }, 'p.mjs'), undefined)
})

test('the shelf is emptied, restored from and read in full', () => {
  const cwd = dir()
  run(cwd, 'bookmark -add one\nwith a second line')
  run(cwd, 'bookmark -add two')
  run(cwd, 'push -all')
  assert.equal(run(cwd, 'details s1'), 'SHELF #1\none\nwith a second line')
  assert.equal(run(cwd, 'pop s2'), 'Moved to the bookmark list: two\nThe bookmark list:\ntwo [b1]')
  assert.equal(run(cwd, 'details b1'), 'BOOKMARK #1\ntwo')
  assert.equal(run(cwd, 'pop -all'), 'Moved 1 to the bookmark list.\nThe bookmark list:\ntwo [b1]\none [b2]')
  run(cwd, 'push -all')
  assert.equal(run(cwd, 'remove s1'), 'Removed: two')
  assert.equal(run(cwd, 'shelf'), 'one [s1]')
  run(cwd, 'bookmark -add three')
  run(cwd, 'push -all')
  assert.equal(run(cwd, 'remove s -all'), 'Removed all 2 from the shelf.')
  assert.equal(run(cwd, 'remove s -all'), 'The shelf is empty.')
  run(cwd, 'bookmark -add one')
  run(cwd, 'push -all')
  assert.equal(run(cwd, 'details b1'), 'The bookmark list is empty.')
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pb pop -all' }, 'p.mjs').reason, 'Moved 1 to the bookmark list.\nThe bookmark list:\none [b1]')
})

test('an item is rewritten by edit, b for the bookmark list and s for the shelf', () => {
  const cwd = dir()
  run(cwd, 'bookmark -add first')
  run(cwd, 'bookmark -add second')
  run(cwd, 'push b2')
  assert.equal(run(cwd, 'edit b1'), 'BOOKMARK #1' + String.fromCharCode(10) + 'first' + String.fromCharCode(10) + 'Type: edit b1 <new text>')
  assert.equal(run(cwd, 'edit b1 first, reworded'), 'Edited.')
  assert.equal(run(cwd, 'edit s1 second, reworded'), 'Edited.')
  assert.equal(run(cwd, 'bookmark'), 'first, reworded [b1]')
  assert.equal(run(cwd, 'shelf'), 'second, reworded [s1]')
  assert.match(run(cwd, 'edit 1'), /^Name the item/)
})

test('lists kept under the old file names are still read, and written under the new ones', () => {
  const cwd = dir()
  mkdirSync(join(cwd, '.pocketbook'))
  writeFileSync(join(cwd, '.pocketbook/todo.md'), '# Pocketbook todo\n\n- old item\n')
  writeFileSync(join(cwd, '.pocketbook/backlog.md'), '# Pocketbook backlog\n\n- old parked\n')

  assert.equal(run(cwd, 'bookmark'), 'old item [b1]')
  assert.equal(run(cwd, 'shelf'), 'old parked [s1]')
  run(cwd, 'bookmark -add new item')
  assert.equal(readFileSync(join(cwd, '.pocketbook/bookmark.md'), 'utf8'), '# Pocketbook bookmark\n\n- old item\n- new item\n')
})
