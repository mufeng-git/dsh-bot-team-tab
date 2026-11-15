import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from './harness.mjs'

const { unwrap } = (await loadBundle()).__internals

test('unwrap takes value out of { ok: true, value }', () => {
  const value = unwrap({ ok: true, value: { bots: [{ id: 'b1', name: '玄机' }] } })
  assert.equal(value.bots.length, 1)
})

test('unwrap tolerates a payload with no envelope', () => {
  assert.equal(unwrap({ bots: [] }).bots.length, 0)
})

test('unwrap turns { ok: false, error } into an Error', () => {
  assert.throws(() => unwrap({ ok: false, error: { code: 'bot/internal', message: 'boom' } }), /boom/)
})

test('unwrap falls back to the error code when the message is missing', () => {
  assert.throws(() => unwrap({ ok: false, error: { code: 'bot/unavailable' } }), /bot\/unavailable/)
})
