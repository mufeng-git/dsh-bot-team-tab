/**
 * Offline self-test for dsh-bot-team-tab.
 *
 * Loads lib/client.js the way the browser does — a stub window.__ModuleLoader__
 * that keeps the factory, a stub require('react') — then checks the two things
 * that can be wrong without a browser: how an api/bot answer is normalised, and
 * which rows apply(ctx) registers.
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
  useCallback: (fn) => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

let exported = null
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {} },
  __ModuleLoader__: {
    load: ({ factory }) => {
      exported = factory((name) => (name === 'react' ? reactStub : {}))
    },
  },
}
globalThis.document = undefined

const source = await readFile(clientPath, 'utf8')
new Function('window', 'document', source)(globalThis.window, undefined)
assert.ok(exported && exported.apply && exported.__internals, 'the bundle must export apply() and __internals')

const { normalize, ROW_PREFIX, ROW_ORDER } = exported.__internals
let checks = 0
const ok = (name) => { checks += 1; console.log('  ok  ' + name) }

// ---- normalize -----------------------------------------------------------

const full = normalize({
  mainBotId: 'b1',
  bots: [
    { id: 'b1', name: '玄机', sessionId: 's-1', state: 'idle' },
    { id: 'b2', sessionId: 's-2' },
    { id: 'b1', name: '重复的同一个' },
    { name: '没有 id' },
    null,
    'garbage',
  ],
})
assert.equal(full.bots.length, 3, 'duplicate ids collapse, junk entries drop')
assert.equal(full.bots[0].name, '玄机')
assert.equal(full.bots[0].sessionId, 's-1')
assert.equal(full.bots[1].name, 'b2', 'a missing name falls back to the id')
assert.equal(full.bots[1].sessionId, 's-2')
assert.equal(full.bots[2].id, '没有 id', 'name doubles as the id when id is absent')
assert.equal(full.mainBotId, 'b1')
ok('normalize keeps id / name / sessionId, drops duplicates and junk')

assert.equal(normalize(undefined).bots.length, 0)
assert.equal(normalize({}).bots.length, 0)
assert.equal(normalize({ bots: 'nope' }).bots.length, 0)
ok('normalize survives a missing or malformed answer')

assert.equal(normalize({ bots: [{ id: 'x', currentSessionId: 's-9' }] }).bots[0].sessionId, 's-9')
ok('normalize accepts currentSessionId')

// ---- apply ---------------------------------------------------------------

const registered = []
const ctx = {
  slots: {
    register: (options) => {
      registered.push(options)
      return () => {}
    },
    inject: (name, factory) => factory(),
  },
  effect: (factory) => {
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  get: () => null,
  uiWorkspace: { openSession: () => {} },
}

globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    bots: [
      { id: 'b1', name: '玄机', sessionId: 's-1' },
      { id: 'b2', name: '小助手', sessionId: 's-2' },
      { id: 'b3', name: '没会话的' },
    ],
  }),
})

exported.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 30))

const rows = registered.filter((o) => o.name === 'sidebar.panellist')
const pages = registered.filter((o) => o.name === 'main')

assert.deepEqual(rows.map((r) => r.id).sort(), [ROW_PREFIX + 'b1', ROW_PREFIX + 'b2', ROW_PREFIX + 'b3'])
ok('one row per Bot, id prefixed with the Bot id')

assert.deepEqual(pages.map((p) => p.key).sort(), rows.map((r) => r.id).sort())
ok('every row has a page with the same key')

for (const row of rows) {
  assert.equal(typeof row.label, 'function', 'the label is read live')
  assert.equal(row.order, ROW_ORDER, 'rows sit together under 「新建会话」')
  const botId = row.id.slice(ROW_PREFIX.length)
  const expected = { b1: '玄机', b2: '小助手', b3: '没会话的' }[botId]
  assert.equal(row.label(), expected)
}
ok('a row is labelled with the Bot name')

assert.ok(!registered.some((o) => o.id === 'zdhcs:bot-settings'), 'no settings row')
ok('no settings row')

assert.ok(registered.some((o) => o.name === 'sidebar.session.row.trailing'), 'the BOT badge is still registered')
ok('the session badge is still registered')

console.log('\n' + checks + ' checks passed')
// apply() starts a 5 s poll; without this the process would never settle.
process.exit(0)
