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

const { normalize, unwrap, ROW_PREFIX, ROW_ORDER, SHAPE_GLYPHS, glyphIcon, BotIcon } = exported.__internals
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

// ---- icon shapes ---------------------------------------------------------

assert.equal(normalize({ bots: [{ id: 'b1', avatar: { shape: 'star' } }] }).bots[0].shape, 'star')
assert.equal(normalize({ bots: [{ id: 'b1' }] }).bots[0].shape, '')
assert.equal(normalize({ bots: [{ id: 'b1', avatar: 'nope' }] }).bots[0].shape, '')
assert.equal(normalize({ bots: [{ id: 'b1', avatar: { shape: 42 } }] }).bots[0].shape, '')
ok('normalize keeps avatar.shape and tolerates a missing or malformed avatar')

const SHAPES = ['whale', 'star', 'moon', 'wave', 'squircle', 'zed', 'hex']
const drawn = SHAPES.map((shape) => glyphIcon(shape, { size: 16, active: false }))
drawn.forEach((el, index) => {
  assert.equal(el.type, 'svg', SHAPES[index] + ' is drawn as a line glyph')
  assert.equal(el.props.width, 16)
  assert.equal(el.props.fill, 'none', 'glyphs are stroke only')
  assert.ok(el.children.flat().length >= 1, SHAPES[index] + ' carries geometry')
})
assert.notDeepEqual(drawn[1].children, drawn[6].children, 'different shapes draw different geometry')
assert.equal(SHAPES.length, Object.keys(SHAPE_GLYPHS).length, 'the table covers exactly the seven shapes')
assert.deepEqual(glyphIcon('not-a-real-shape', { size: 18 }), BotIcon({ size: 18 }), 'an unknown shape falls back to the robot')
assert.deepEqual(glyphIcon('', undefined), BotIcon(undefined), 'a missing shape falls back to the robot')
assert.notDeepEqual(glyphIcon('star', { size: 16 }), BotIcon({ size: 16 }), 'a known shape does not fall back')
ok('seven character shapes draw distinct line glyphs, unknown falls back to the robot')

// ---- unwrap --------------------------------------------------------------

const wrapped = unwrap({ ok: true, value: { bots: [{ id: 'b1', name: '玄机' }] } })
assert.equal(wrapped.bots.length, 1, 'the envelope is unwrapped to its value')
ok('unwrap takes value out of { ok: true, value }')

assert.equal(unwrap({ bots: [] }).bots.length, 0, 'a bare payload still works')
ok('unwrap tolerates a payload with no envelope')

let threw = ''
try { unwrap({ ok: false, error: { code: 'bot/internal', message: 'boom' } }) } catch (err) { threw = String(err.message) }
assert.equal(threw, 'boom', 'a refusal becomes an Error')
ok('unwrap turns { ok: false, error } into an Error')

// ---- apply ---------------------------------------------------------------

const registered = []
// The shell hands services to a plugin through ctx.inject() only; this stub keeps
// that contract, so a regression back to a bare ctx.get() fails here, not in the GUI.
const opened = []
const selected = []
const panelListeners = new Set()
let activePanelId = ''
const panelInfo = {
  getSnapshot: () => ({ activePanelId }),
  subscribe: (listener) => {
    panelListeners.add(listener)
    return () => panelListeners.delete(listener)
  },
}
const injectedScope = {
  uiWorkspace: { openSession: (sessionId) => { opened.push(sessionId) } },
  layout: { selectPanel: (id) => { selected.push(id) }, panelInfo },
  get(name) { return this[name] ?? null },
}

const ctx = {
  slots: {
    register: (options, component) => {
      registered.push(Object.assign({}, options, { component: component }))
      return () => {}
    },
    inject: (name, factory) => factory(),
  },
  effect: (factory) => {
    const dispose = factory()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  get: () => null,
  inject: (names, callback) => {
    const cleanup = callback(injectedScope)
    return { dispose: () => { if (typeof cleanup === 'function') cleanup() } }
  },
}

globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    ok: true,
    value: {
      bots: [
        { id: 'b1', name: '玄机', sessionId: 's-1', avatar: { shape: 'star', color: 'blue' } },
        { id: 'b2', name: '小助手', sessionId: 's-2', avatar: { shape: 'hex' } },
        { id: 'b3', name: '没会话的' },
      ],
    },
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

const iconOf = (botId) => rows.find((r) => r.id === ROW_PREFIX + botId).component({ size: 16, active: false })
assert.equal(iconOf('b1').type, 'svg', 'a Bot with a shape draws a glyph')
assert.equal(iconOf('b2').type, 'svg', 'each Bot draws its own glyph')
assert.notDeepEqual(iconOf('b1').children, iconOf('b2').children, 'two Bots with different shapes differ on the rail')
assert.deepEqual(iconOf('b3'), BotIcon({ size: 16 }), 'a Bot without a shape falls back to the robot')
ok('a row icon is drawn from that Bot avatar shape')

assert.ok(!registered.some((o) => o.id === 'zdhcs:bot-settings'), 'no settings row')
ok('no settings row')

assert.ok(registered.some((o) => o.name === 'sidebar.session.row.trailing'), 'the BOT badge is still registered')
ok('the session badge is still registered')

// ---- click path ----------------------------------------------------------

activePanelId = ROW_PREFIX + 'b1'
panelListeners.forEach((listener) => listener())
await new Promise((resolve) => setTimeout(resolve, 20))

assert.deepEqual(selected, [null], 'the selected row leaves the panel first')
ok('a selected Bot row leaves the panel first')
assert.deepEqual(opened, ['s-1'], 'the row opens that Bot session')
ok('a selected Bot row opens the Bot session through the injected scope')

console.log('\n' + checks + ' checks passed')
// apply() starts a 5 s poll; without this the process would never settle.
process.exit(0)
