import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, tick } from './harness.mjs'

const BOTS = [
  { id: 'b1', name: '玄机', sessionId: 's-1' },
  { id: 'b2', name: '安澜', sessionId: 's-2' },
  { id: 'b3', name: '没会话的' },
]

/** Boots the plugin and selects one row the way the sidebar does. */
async function selectRow(id, options) {
  const harness = await createHarness(options || { bots: BOTS })
  harness.exported.apply(harness.ctx)
  await tick(10)
  harness.selectRow(id)
  await tick(30)
  return harness
}

test('selecting a Bot row opens that Bot session and leaves the panel', async () => {
  const harness = await selectRow(harness_prefix())
  assert.deepEqual(harness.selected, [null], 'the selected row leaves the panel first')
  assert.deepEqual(harness.opened, ['s-1'], 'the row opens that Bot session through the injected scope')
  const events = harness.events()
  assert.ok(events.includes('jump:start'))
  assert.ok(events.includes('jump:opened'))
  const start = harness.logs.find((line) => line.event === 'jump:start')
  assert.equal(start.data.via, 'watch', 'the jump hangs off the panel selection, not off a mounting page')
})

function harness_prefix() {
  return 'zdhcs:bot:b1'
}

test('a row whose Bot has no session opens nothing and says so', async () => {
  const harness = await selectRow('zdhcs:bot:b3')
  assert.deepEqual(harness.opened, [])
  const start = harness.logs.find((line) => line.event === 'jump:start')
  assert.equal(start.data.hasBot, true)
  assert.equal(start.data.sessionId, '')
})

test('a row without a workspace service logs jump:noWorkspace instead of throwing', async () => {
  const harness = await selectRow('zdhcs:bot:b1', { bots: BOTS, noWorkspace: true })
  assert.deepEqual(harness.opened, [])
  assert.ok(harness.events().includes('jump:noWorkspace'))
})

test('a throwing openSession is logged and does not take the sidebar down', async () => {
  const harness = await selectRow('zdhcs:bot:b2', {
    bots: BOTS,
    openSession: () => { throw new Error('session gone') },
  })
  assert.ok(harness.events().includes('jump:openSession:error'))
  const failure = harness.logs.find((line) => line.event === 'jump:openSession:error')
  assert.match(String(failure.data.message), /session gone/)
  assert.deepEqual(harness.selected, [null], 'the panel still steps out of the way')
})
