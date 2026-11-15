import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const source = readFileSync(path.join(root, 'lib', 'client.js'), 'utf8')

test('package.json 与 lib/client.js 的 VERSION 一致', () => {
  const found = /const VERSION = '([^']+)'/.exec(source)
  assert.ok(found, 'lib/client.js 里没有 const VERSION')
  assert.equal(found[1], pkg.version)
})

