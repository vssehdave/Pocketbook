import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hook, run, summaryOf } from './pocketbook.mjs'

const dir = () => mkdtempSync(join(tmpdir(), 'pb-'))

test('the todo list is added to, stashed, removed from and moved whole', () => {
  const cwd = dir()
  mkdirSync(join(cwd, '.git'))

  assert.equal(run(cwd, 'todo'), 'The todo list is empty.')
  run(cwd, 'todo -add first task')
  run(cwd, 'todo -add second task')
  assert.equal(run(cwd, 'todo -add third task'), 'Added. The todo list:\nfirst task [t1]\nsecond task [t2]\nthird task [t3]')
  assert.equal(readFileSync(join(cwd, '.gitignore'), 'utf8'), '.pocketbook/\n')
  assert.equal(run(cwd, 'push t2'), 'Moved to the backlog: second task\nThe todo list:\nfirst task [t1]\nthird task [t2]')
  assert.equal(run(cwd, 'remove t1'), 'Removed: first task\nThe todo list:\nthird task [t1]')
  assert.equal(run(cwd, 'remove t5'), 'Give the number of an item, 1 to 1.')
  assert.equal(run(cwd, 'push -all'), 'Moved 1 to the backlog.\nThe todo list is empty.')
  assert.equal(run(cwd, 'backlog'), 'second task [b1]\nthird task [b2]')
})

test('a request of several lines keeps its first line as the summary and the whole under it', () => {
  const cwd = dir()
  run(cwd, 'todo -add fix the footer\nthen the colors')

  assert.equal(summaryOf('\n  fix   the footer\nmore'), 'fix the footer')
  assert.match(readFileSync(join(cwd, '.pocketbook/todo.md'), 'utf8'), /- fix the footer\n {2}fix the footer\n {2}then the colors/)
})

test('a prompt typed as "pb ..." is answered by the hook and not sent on', () => {
  const cwd = dir()

  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pb todo -add write docs' }, 'p.mjs').decision, 'block')
  assert.equal(hook(cwd, 'prompt', 'gemini', { prompt: 'PB todo' }, 'p.mjs').decision, 'deny')
  assert.match(hook(cwd, 'prompt', 'codex', { prompt: 'pb todo' }, 'p.mjs').reason, /write docs \[t1\]/)
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pbj is a word' }, 'p.mjs')?.decision, undefined)
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pb is short for pocketbook' }, 'p.mjs')?.decision, undefined)
})

test('a todo added during a reply is handed back when the reply ends, once', () => {
  const cwd = dir()
  hook(cwd, 'prompt', 'codex', { prompt: 'build it' }, 'p.mjs')
  hook(cwd, 'prompt', 'codex', { prompt: 'pb todo -add second' }, 'p.mjs')

  const stop = hook(cwd, 'stop', 'codex', {}, 'p.mjs')
  assert.equal(stop.decision, 'block')
  assert.match(stop.reason, /second \[t1\]/)
  assert.equal(hook(cwd, 'stop', 'codex', {}, 'p.mjs'), undefined)
})

test('a continued stop is left alone, and so is an empty list', () => {
  const cwd = dir()
  hook(cwd, 'prompt', 'codex', { prompt: 'build it' }, 'p.mjs')
  run(cwd, 'todo -add second')

  assert.equal(hook(cwd, 'stop', 'codex', { stop_hook_active: true }, 'p.mjs'), undefined)
  run(cwd, 'remove t1')
  assert.equal(hook(cwd, 'stop', 'codex', {}, 'p.mjs'), undefined)
})

test('when the reply never ended, the next prompt carries the word', () => {
  const cwd = dir()
  hook(cwd, 'prompt', 'codex', { prompt: 'build it' }, 'p.mjs')
  run(cwd, 'todo -add second')

  const next = hook(cwd, 'prompt', 'codex', { prompt: 'carry on' }, 'p.mjs')
  assert.match(next.hookSpecificOutput.additionalContext, /todo items were added while you worked/)
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'and again' }, 'p.mjs'), undefined)
})

test('a broken state file is read as empty', () => {
  const cwd = dir()
  mkdirSync(join(cwd, '.pocketbook'))
  writeFileSync(join(cwd, '.pocketbook/state.json'), '{nope')

  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'hello' }, 'p.mjs'), undefined)
})

test('the backlog is emptied, restored from and read in full', () => {
  const cwd = dir()
  run(cwd, 'todo -add one\nwith a second line')
  run(cwd, 'todo -add two')
  run(cwd, 'push -all')
  assert.equal(run(cwd, 'details b1'), 'BACKLOG #1\none\nwith a second line')
  assert.equal(run(cwd, 'pop b2'), 'Moved to the todo list: two\nThe todo list:\ntwo [t1]')
  assert.equal(run(cwd, 'details t1'), 'TODO #1\ntwo')
  assert.equal(run(cwd, 'pop -all'), 'Moved 1 to the todo list.\nThe todo list:\ntwo [t1]\none [t2]')
  run(cwd, 'push -all')
  assert.equal(run(cwd, 'remove b1'), 'Removed: two')
  assert.equal(run(cwd, 'backlog'), 'one [b1]')
  run(cwd, 'todo -add three')
  run(cwd, 'push -all')
  assert.equal(run(cwd, 'remove b -all'), 'Removed all 2 from the backlog.')
  assert.equal(run(cwd, 'remove b -all'), 'The backlog is empty.')
  run(cwd, 'todo -add one')
  run(cwd, 'push -all')
  assert.equal(run(cwd, 'details t1'), 'The todo list is empty.')
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pb pop -all' }, 'p.mjs').reason, 'Moved 1 to the todo list.\nThe todo list:\none [t1]')
})

test('an item is rewritten by edit, t for the todo list and b for the backlog', () => {
  const cwd = dir()
  run(cwd, 'todo -add first')
  run(cwd, 'todo -add second')
  run(cwd, 'push t2')
  assert.equal(run(cwd, 'edit t1'), 'TODO #1' + String.fromCharCode(10) + 'first' + String.fromCharCode(10) + 'Type: edit t1 <new text>')
  assert.equal(run(cwd, 'edit t1 first, reworded'), 'Edited.')
  assert.equal(run(cwd, 'edit b1 second, reworded'), 'Edited.')
  assert.equal(run(cwd, 'todo'), 'first, reworded [t1]')
  assert.equal(run(cwd, 'backlog'), 'second, reworded [b1]')
  assert.match(run(cwd, 'edit 1'), /^Name the item/)
})
