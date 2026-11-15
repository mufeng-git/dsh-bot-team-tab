import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, tick, installClock } from './harness.mjs'

const BOTS = [
  { id: 'b1', name: '玄机', sessionId: 's-1', avatar: { shape: 'star', color: 'blue' } },
  { id: 'b2', name: '小助手', sessionId: 's-2', avatar: { shape: 'hex' } },
  { id: 'b3', name: '没会话的' },
]

async function boot(options) {
  const clock = installClock()
  const harness = await createHarness(options)
  harness.exported.apply(harness.ctx)
  await tick(10)
  return { harness, clock }
}

const rowsOf = (harness) => harness.registered.filter((entry) => entry.name === 'sidebar.panellist')
const pagesOf = (harness) => harness.registered.filter((entry) => entry.name === 'main')

test('one left-rail row per Bot, each with its own page', async (t) => {
  const { harness, clock } = await boot({ bots: BOTS })
  t.after(() => clock.restore())
  const { ROW_PREFIX, ROW_ORDER, BotIcon } = harness.internals

  const rows = rowsOf(harness)
  const pages = pagesOf(harness)
  assert.deepEqual(rows.map((row) => row.id).sort(), [ROW_PREFIX + 'b1', ROW_PREFIX + 'b2', ROW_PREFIX + 'b3'])
  assert.deepEqual(pages.map((page) => page.key).sort(), rows.map((row) => row.id).sort())

  // The host refuses to select a row whose page is missing, so the page must be
  // registered first for every Bot, not just for the roster as a whole.
  for (const row of rows) {
    const pageIndex = harness.registered.findIndex((entry) => entry.name === 'main' && entry.key === row.id)
    const rowIndex = harness.registered.indexOf(row)
    assert.ok(pageIndex >= 0 && pageIndex < rowIndex, 'page for ' + row.id + ' is registered before its row')
  }

  for (const row of rows) {
    assert.equal(typeof row.label, 'function', 'the label is read live')
    assert.equal(row.order, ROW_ORDER, 'rows sit together under 「新建会话」')
  }
  const named = Object.fromEntries(rows.map((row) => [row.id.slice(ROW_PREFIX.length), row.label()]))
  assert.deepEqual(named, { b1: '玄机', b2: '小助手', b3: '没会话的' })

  const iconOf = (botId) => rows.find((row) => row.id === ROW_PREFIX + botId).component({ size: 16, active: false })
  assert.equal(iconOf('b1').type, 'svg')
  assert.equal(iconOf('b2').type, 'svg')
  assert.notDeepEqual(iconOf('b1').children, iconOf('b2').children, 'two Bots with different shapes differ on the rail')
  assert.deepEqual(iconOf('b3'), BotIcon({ size: 16 }), 'a Bot without a shape falls back to the robot')

  assert.ok(!harness.registered.some((entry) => String(entry.id || '').includes('bot-settings')), 'no settings row')
  assert.ok(harness.registered.some((entry) => entry.name === 'sidebar.session.row.trailing'), 'the BOT badge is registered')
  assert.equal(harness.events().filter((event) => event === 'row:register').length, 3)
  const start = harness.logs.find((line) => line.event === 'apply:start')
  assert.equal(start.v, harness.internals.VERSION, 'the log records the running version')
})

test('a Bot leaving the roster drops its row and page; coming back re-registers', async (t) => {
  const { harness, clock } = await boot({ bots: BOTS })
  t.after(() => clock.restore())
  const { ROW_PREFIX } = harness.internals

  harness.setBots([BOTS[0], BOTS[2]])
  await clock.flush()
  const afterDrop = rowsOf(harness).map((row) => row.id).sort()
  assert.deepEqual(afterDrop, [ROW_PREFIX + 'b1', ROW_PREFIX + 'b3'])
  assert.deepEqual(pagesOf(harness).map((page) => page.key).sort(), afterDrop)
  assert.ok(harness.events().includes('row:drop'), 'the drop is recorded in the host log')

  harness.setBots(BOTS)
  await clock.flush()
  assert.deepEqual(rowsOf(harness).map((row) => row.id).sort(), [ROW_PREFIX + 'b1', ROW_PREFIX + 'b2', ROW_PREFIX + 'b3'])
})

test('an updated Bot name is picked up without re-registering the row', async (t) => {
  const { harness, clock } = await boot({ bots: BOTS })
  t.after(() => clock.restore())
  const { ROW_PREFIX } = harness.internals
  const row = rowsOf(harness).find((entry) => entry.id === ROW_PREFIX + 'b1')

  harness.setBots([{ ...BOTS[0], name: '玄机二号' }, BOTS[1], BOTS[2]])
  await clock.flush()
  assert.equal(row.label(), '玄机二号', 'the label reads the live store')
})
