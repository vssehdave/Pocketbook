import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { hook, run, summaryOf } from './pocketbook.mjs'

const dir = () => mkdtempSync(join(tmpdir(), 'pb-'))

test('the todo list is added to, stashed, removed from and archived', () => {
  const cwd = dir()
  mkdirSync(join(cwd, '.git'))

  assert.equal(run(cwd, 'todo'), 'The todo list is empty.')
  run(cwd, 'todo -add first task')
  run(cwd, 'todo -add second task')
  assert.equal(run(cwd, 'todo -add third task'), 'Added. The todo list:\nfirst task [1]\nsecond task [2]\nthird task [3]')
  assert.equal(readFileSync(join(cwd, '.gitignore'), 'utf8'), '.pocketbook/\n')
  assert.equal(run(cwd, 'stash 2'), 'Moved to the backlog: second task\nThe todo list:\nfirst task [1]\nthird task [2]')
  assert.equal(run(cwd, 'todo -remove 1'), 'Removed: first task\nThe todo list:\nthird task [1]')
  assert.equal(run(cwd, 'todo -remove 5'), 'Give the number of an item, 1 to 1.')
  assert.equal(run(cwd, 'archive'), 'Moved 1 to the backlog.\nThe todo list is empty.')
  assert.equal(run(cwd, 'backlog'), 'second task [1]\nthird task [2]')
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
  assert.match(hook(cwd, 'prompt', 'codex', { prompt: 'pb todo' }, 'p.mjs').reason, /write docs \[1\]/)
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pbj is a word' }, 'p.mjs')?.decision, undefined)
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pb is short for pocketbook' }, 'p.mjs')?.decision, undefined)
})

test('a todo added during a reply is handed back when the reply ends, once', () => {
  const cwd = dir()
  hook(cwd, 'prompt', 'codex', { prompt: 'build it' }, 'p.mjs')
  hook(cwd, 'prompt', 'codex', { prompt: 'pb todo -add second' }, 'p.mjs')

  const stop = hook(cwd, 'stop', 'codex', {}, 'p.mjs')
  assert.equal(stop.decision, 'block')
  assert.match(stop.reason, /second \[1\]/)
  assert.equal(hook(cwd, 'stop', 'codex', {}, 'p.mjs'), undefined)
})

test('a continued stop is left alone, and so is an empty list', () => {
  const cwd = dir()
  hook(cwd, 'prompt', 'codex', { prompt: 'build it' }, 'p.mjs')
  run(cwd, 'todo -add second')

  assert.equal(hook(cwd, 'stop', 'codex', { stop_hook_active: true }, 'p.mjs'), undefined)
  run(cwd, 'todo -remove 1')
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
  run(cwd, 'archive')
  assert.equal(run(cwd, 'details -backlog 1'), 'BACKLOG #1\none\nwith a second line')
  assert.equal(run(cwd, 'unstash 2'), 'Moved to the todo list: two\nThe todo list:\ntwo [1]')
  assert.equal(run(cwd, 'details -todo 1'), 'TODO #1\ntwo')
  assert.equal(run(cwd, 'restore'), 'Moved 1 to the todo list.\nThe todo list:\ntwo [1]\none [2]')
  run(cwd, 'archive')
  assert.equal(run(cwd, 'backlog -remove 1'), 'Removed: two')
  assert.equal(run(cwd, 'backlog'), 'one [1]')
  run(cwd, 'todo -add three')
  run(cwd, 'archive')
  assert.equal(run(cwd, 'backlog -remove -all'), 'Removed all 2 from the backlog.')
  assert.equal(run(cwd, 'backlog -remove -all'), 'The backlog is empty.')
  run(cwd, 'todo -add one')
  run(cwd, 'archive')
  assert.equal(run(cwd, 'details -todo 1'), 'Use: details -todo <n> or details -backlog <n>.')
  assert.equal(hook(cwd, 'prompt', 'codex', { prompt: 'pb restore' }, 'p.mjs').reason, 'Moved 1 to the todo list.\nThe todo list:\none [1]')
})
