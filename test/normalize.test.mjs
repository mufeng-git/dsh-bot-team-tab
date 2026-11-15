import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from './harness.mjs'

const { normalize } = (await loadBundle()).__internals

test('normalize keeps id / name / sessionId and drops duplicates and junk', () => {
  const answer = normalize({
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
  assert.equal(answer.bots.length, 3)
  assert.equal(answer.bots[0].name, '玄机')
  assert.equal(answer.bots[0].sessionId, 's-1')
  assert.equal(answer.bots[1].name, 'b2', 'a missing name falls back to the id')
  assert.equal(answer.bots[2].id, '没有 id', 'name doubles as the id when id is absent')
  assert.equal(answer.mainBotId, 'b1')
})

test('normalize survives a missing or malformed answer', () => {
  assert.equal(normalize(undefined).bots.length, 0)
  assert.equal(normalize({}).bots.length, 0)
  assert.equal(normalize({ bots: 'nope' }).bots.length, 0)
})

test('normalize accepts currentSessionId', () => {
  assert.equal(normalize({ bots: [{ id: 'x', currentSessionId: 's-9' }] }).bots[0].sessionId, 's-9')
})

test('normalize keeps avatar.shape and tolerates a missing or malformed avatar', () => {
  assert.equal(normalize({ bots: [{ id: 'b1', avatar: { shape: 'star' } }] }).bots[0].shape, 'star')
  assert.equal(normalize({ bots: [{ id: 'b1' }] }).bots[0].shape, '')
  assert.equal(normalize({ bots: [{ id: 'b1', avatar: 'nope' }] }).bots[0].shape, '')
  assert.equal(normalize({ bots: [{ id: 'b1', avatar: { shape: 42 } }] }).bots[0].shape, '')
})
