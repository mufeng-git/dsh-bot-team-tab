#!/usr/bin/env node
/**
 * Inspect an Electron .asar archive without unpacking it. DSH ships its
 * client sources inside resources/app.asar, and reading the contract from
 * there is the cheapest way to stop guessing at slot names and prop shapes.
 *
 *   node scripts/asar.mjs paths <app.asar> [needle]      every path matching needle
 *   node scripts/asar.mjs ls    <app.asar> [needle]      matches, largest first
 *   node scripts/asar.mjs cat   <app.asar> <needle>      print the first match
 *   node scripts/asar.mjs get   <app.asar> <needle> <dir>  extract every match
 *   node scripts/asar.mjs find  <app.asar> <offset...>   byte offset -> file path
 *
 * Zero dependencies; reads only the archive header and the requested spans.
 */

import { mkdir, open, writeFile } from 'node:fs/promises'
import path from 'node:path'

const HEADER = 16

async function openArchive(file) {
  const handle = await open(file, 'r')
  const probe = Buffer.alloc(HEADER)
  await handle.read(probe, 0, HEADER, 0)
  const jsonSize = probe.readUInt32LE(12)
  const json = Buffer.alloc(jsonSize)
  await handle.read(json, 0, jsonSize, HEADER)
  const index = JSON.parse(json.toString('utf8').replace(/\u0000+$/g, ''))
  return { handle, index, baseOffset: 8 + jsonSize }
}

function collect(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const full = prefix + '/' + name
    if (entry.files) collect(entry, full, out)
    else if (typeof entry.size === 'number' && entry.unpacked !== true) out.push({ path: full, size: entry.size, offset: Number(entry.offset) })
  }
  return out
}

const match = (entries, needle) => (needle ? entries.filter((e) => e.path.includes(needle)) : entries)

async function readEntry(archive, entry, max) {
  const size = max === undefined ? entry.size : Math.min(entry.size, max)
  const buffer = Buffer.alloc(size)
  await archive.handle.read(buffer, 0, size, archive.baseOffset + entry.offset)
  return buffer
}

const [command, file, ...rest] = process.argv.slice(2)
if (!command || !file || !['paths', 'ls', 'cat', 'get', 'find'].includes(command)) {
  console.error('usage: node scripts/asar.mjs <paths|ls|cat|get|find> <app.asar> [arg...]')
  process.exit(2)
}

const archive = await openArchive(file)
const entries = collect(archive.index, '', [])

try {
  if (command === 'paths') {
    const hits = match(entries, rest[0])
    for (const hit of hits) console.log(hit.path)
    console.error('asar: ' + hits.length + ' of ' + entries.length + ' files')
  } else if (command === 'ls') {
    const hits = match(entries, rest[0]).sort((a, b) => b.size - a.size)
    for (const hit of hits.slice(0, 60)) console.log(String(hit.size).padStart(9) + '  ' + hit.path)
    console.error('asar: showing ' + Math.min(hits.length, 60) + ' of ' + hits.length)
  } else if (command === 'cat') {
    const hit = match(entries, rest[0])[0]
    if (!hit) { console.error('asar: no match for ' + rest[0]); process.exit(1) }
    const buffer = await readEntry(archive, hit)
    process.stdout.write(buffer)
  } else if (command === 'get') {
    const hits = match(entries, rest[0])
    const outDir = rest[1] ?? '.asar-out'
    for (const hit of hits) {
      const dest = path.join(outDir, hit.path.replace(/^\//, ''))
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, await readEntry(archive, hit))
      console.log(dest)
    }
    console.error('asar: extracted ' + hits.length + ' file(s)')
  } else {
    const all = entries.sort((a, b) => a.offset - b.offset)
    for (const raw of rest) {
      const relative = Number(raw) - archive.baseOffset
      const hit = all.find((e) => relative >= e.offset && relative < e.offset + e.size)
      console.log(raw + ' -> ' + (hit ? hit.path + ' +' + (relative - hit.offset) : 'no entry'))
    }
  }
} finally {
  await archive.handle.close()
}
