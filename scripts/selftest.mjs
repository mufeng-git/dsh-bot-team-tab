/**
 * Offline self-test for dsh-bot-team-tab.
 *
 * Loads lib/client.js the way the browser does — a stub window.__ModuleLoader__
 * that keeps the factory, a stub require('react') — and drives the pure
 * classification, grouping and formatting code against fixtures shaped like
 * DS Bot 0.3.6's api/bot state answer. No browser, no DSH, no network.
 *
 *   node scripts/selftest.mjs
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientPath = path.join(here, '..', 'lib', 'client.js')

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
}

let moduleExports = null
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => {
      moduleExports = factory((name) => {
        if (name === 'react') return reactStub
        throw new Error('unexpected require: ' + name)
      })
      moduleExports.__id = id
    },
  },
}

await readFile(clientPath, 'utf8')
await import('file:///' + clientPath.split(path.sep).join('/'))

assert.ok(moduleExports, 'the bundle must call window.__ModuleLoader__.load')
assert.equal(moduleExports.__id, 'dsh-bot-team-tab')
assert.deepEqual(moduleExports.inject, ['betterSidebar'])
assert.equal(typeof moduleExports.apply, 'function')

const api = moduleExports.__internals
const d = api.DICT.zh
const now = 1700000000000
const checks = []

function check(name, fn) {
  fn()
  checks.push(name)
}

const botA = { id: 'a', name: '甲', role: '结构', color: '#123456', sessionId: 's-a', lastAt: now - 5000 }
const botB = { id: 'b', name: '乙', sessionId: 's-b' }
const botC = { id: 'c', name: '丙', sessionId: 's-c', section: 'sec-1' }
const work = (over) => Object.assign({ bots: {}, approvals: [], waiting: {}, turns: {} }, over || {})
const view = (over) => Object.assign({ work: work(), justFinished: {} }, over || {})

check('idle when DS Bot knows nothing about it', () => {
  assert.equal(api.classify(botA, view(), now).state, 'idle')
})

check('needs-you wins over a running turn (an approval sits open)', () => {
  const v = view({ work: work({ bots: { a: { since: now - 1000 } }, approvals: [{ sessionId: 's-a' }] }) })
  assert.equal(api.classify(botA, v, now).state, 'needsYou')
})

check('needs-you when the Bot holds its greeting for a model choice', () => {
  const held = Object.assign({}, botA, { waiting: true })
  assert.equal(api.classify(held, view(), now).state, 'needsYou')
})

check('an approval pointing at another Bot is not mine', () => {
  const v = view({ work: work({ approvals: [{ sessionId: 's-b' }] }) })
  assert.equal(api.classify(botA, v, now).state, 'idle')
})

check('working carries the stage and the clock', () => {
  const v = view({ work: work({ bots: { a: { since: now - 5000, tool: 'read', target: 'spec.md' } } }) })
  const verdict = api.classify(botA, v, now)
  assert.equal(verdict.state, 'working')
  assert.equal(api.stateText(botA, verdict, now, d), 'read · spec.md · 5s')
})

check('a running turn in a group with a hand-off waiting reads as waiting on a Bot', () => {
  const v = view({
    work: work({
      bots: { a: { since: now - 1000, roomId: 'room-1' } },
      waiting: { a: { waits: [{ name: '乙' }] } },
    }),
  })
  assert.equal(api.classify(botA, v, now).state, 'waitingBot')
})

check('waiting on another Bot outside a turn', () => {
  const v = view({ work: work({ waiting: { a: { waits: [{ to: 'b', name: '乙' }] } } }) })
  const verdict = api.classify(botA, v, now)
  assert.equal(verdict.state, 'waitingBot')
  assert.equal(api.stateText(botA, verdict, now, d), '等 乙')
})

check('a blocking failure is read off the Bot itself, not page memory', () => {
  const failed = Object.assign({}, botA, { blocked: { code: 'MISSING_CREDENTIAL', at: now - 1000 } })
  const verdict = api.classify(failed, view(), now)
  assert.equal(verdict.state, 'failed')
  assert.match(api.stateText(failed, verdict, now, d), /MISSING_CREDENTIAL/)
})

check('a failure that sat still for 3 minutes dims to idle but keeps its !', () => {
  const failed = Object.assign({}, botA, { blocked: { code: 'MISSING_CREDENTIAL', at: now - api.STALE_FAIL_MS - 1000 } })
  const verdict = api.classify(failed, view(), now)
  assert.equal(verdict.state, 'idle')
  assert.equal(verdict.blocked, true)
  assert.equal(verdict.stale, true)
})

check('just finished lasts 7 seconds', () => {
  const v = view({ justFinished: { a: now - 1000 } })
  assert.equal(api.classify(botA, v, now).state, 'justFinished')
  const old = view({ justFinished: { a: now - api.JUST_FINISHED_MS - 1 } })
  assert.equal(api.classify(botA, old, now).state, 'idle')
})

check('sections group by DS Bot order, and nothing ungrouped is last', () => {
  const sections = [{ id: 'sec-1', name: '一队', order: 2 }, { id: 'sec-2', name: '二队', order: 1 }]
  const groups = api.buildGroups([botA, Object.assign({}, botB, { section: 'sec-2' }), botC], sections, d)
  assert.deepEqual(groups.map((g) => g.id), ['sec-2', 'sec-1', '__ungrouped'])
  assert.deepEqual(groups[2].bots.map((b) => b.id), ['a'])
  assert.equal(groups[2].name, d.ungrouped)
})

check('an unknown section id falls into the ungrouped bucket instead of vanishing', () => {
  const groups = api.buildGroups([Object.assign({}, botA, { section: 'gone' })], [{ id: 'sec-1', name: '一队', order: 1 }], d)
  assert.deepEqual(groups.map((g) => g.id), ['__ungrouped'])
})

check('a section given as an object still groups', () => {
  const groups = api.buildGroups([Object.assign({}, botA, { section: { id: 'sec-1' } })], [{ id: 'sec-1', name: '一队' }], d)
  assert.deepEqual(groups.map((g) => g.id), ['sec-1'])
})

check('colors: hex passes through, anything else hashes stably', () => {
  assert.equal(api.colorOf({ id: 'x', color: '#abcdef' }), '#abcdef')
  assert.equal(api.colorOf({ id: 'x', color: ['#111111', '#222222'] }), '#111111')
  const first = api.colorOf({ id: 'bot-42' })
  assert.match(first, /^#[0-9A-F]{6}$/i)
  assert.equal(api.colorOf({ id: 'bot-42' }), first)
})

check('elapsed and ago read like a person wrote them', () => {
  assert.equal(api.elapsedText(5000, d), '5s')
  assert.equal(api.elapsedText(65000, d), '1m 5s')
  assert.equal(api.elapsedText(3725000, d), '1h 2m')
  assert.equal(api.agoText(now - 2000, now, d), d.justNow)
  assert.equal(api.agoText(now - 5 * 60000, now, d), '5' + d.minute + d.ago)
})

check('a missing session id is surfaced, never thrown', () => {
  assert.deepEqual(api.chatSessions({}), [])
  assert.deepEqual(api.chatSessions({ sessionId: 's', parts: ['p1', 'p2'] }), ['s', 'p1', 'p2'])
})

check('the poll constants obey the hard floor', () => {
  assert.ok(api.POLL_MS >= 3000, 'never poll faster than 3s')
  assert.deepEqual(api.BACKOFF_MS, [3000, 6000, 12000, 24000, 30000])
  assert.equal(api.TAB_ID, 'zdhcs:bot-team')
})

console.log('ok ' + checks.length + ' checks')
for (const name of checks) console.log('  - ' + name)
