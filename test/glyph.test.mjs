import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadBundle } from './harness.mjs'

const { SHAPE_GLYPHS, glyphIcon, BotIcon } = (await loadBundle()).__internals
const SHAPES = ['whale', 'star', 'moon', 'wave', 'squircle', 'zed', 'hex']

test('seven character shapes draw distinct line glyphs', () => {
  const drawn = SHAPES.map((shape) => glyphIcon(shape, { size: 16, active: false }))
  drawn.forEach((element, index) => {
    assert.equal(element.type, 'svg', SHAPES[index] + ' is drawn as a line glyph')
    assert.equal(element.props.width, 16)
    assert.equal(element.props.fill, 'none', 'glyphs are stroke only')
    assert.ok(element.children.flat().length >= 1, SHAPES[index] + ' carries geometry')
  })
  assert.notDeepEqual(drawn[1].children, drawn[6].children, 'different shapes draw different geometry')
  assert.equal(SHAPES.length, Object.keys(SHAPE_GLYPHS).length, 'the table covers exactly the seven shapes')
})

test('an unknown or missing shape falls back to the robot, a known one does not', () => {
  assert.deepEqual(glyphIcon('not-a-real-shape', { size: 18 }), BotIcon({ size: 18 }))
  assert.deepEqual(glyphIcon('', undefined), BotIcon(undefined))
  assert.notDeepEqual(glyphIcon('star', { size: 16 }), BotIcon({ size: 16 }))
})

test('a glyph follows the requested size', () => {
  assert.equal(glyphIcon('moon', { size: 18 }).props.width, 18)
  assert.equal(glyphIcon('moon', undefined).props.width, 16, 'no size means the wide rail default')
})
