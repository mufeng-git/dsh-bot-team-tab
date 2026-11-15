#!/usr/bin/env node
/**
 * Fails when a Markdown link or a backticked path points at a file that is not
 * in the repository — the same guard the DSH-Bot repository runs in CI, kept
 * small and dependency-free for this plugin.
 *
 *   node scripts/check-docs.mjs
 *
 * Rules:
 *   - [text](target) and ![alt](target): a relative target must exist.
 *   - `path/like/this` where the path ends in .md, .mjs, .js, .json or .yml:
 *     must exist, resolved from the repository root. Commands, URLs and
 *     placeholders are ignored, as are design records under docs/design/,
 *     which cite files from other repositories on purpose.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOC_EXTENSIONS = new Set(['.md', '.mjs', '.js', '.json', '.yml'])
const SKIP_DIRS = new Set(['.git', 'node_modules', 'test'])
const DESIGN_DIR = 'docs/design/'

async function walk(directory) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...await walk(path.join(directory, entry.name)))
    } else if (entry.name.endsWith('.md')) {
      found.push(path.join(directory, entry.name))
    }
  }
  return found
}

const exists = async (target) => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

const problems = []
const files = await walk(root)

for (const file of files) {
  const text = await readFile(file, 'utf8')
  const relative = path.relative(root, file).split(path.sep).join('/')
  const targets = []

  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) targets.push(match[1])
  const checkBackticks = !relative.startsWith(DESIGN_DIR)
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    if (!checkBackticks) break
    const candidate = match[1].trim()
    if (!candidate.includes('/')) continue
    if (/\s/.test(candidate)) continue
    if (candidate.includes('://') || candidate.startsWith('#') || candidate.includes('<')) continue
    if (!DOC_EXTENSIONS.has(path.extname(candidate))) continue
    targets.push(candidate)
  }

  for (const target of targets) {
    if (/^(https?:|mailto:|#)/.test(target)) continue
    if (target.includes('*') || target.includes('<') || target.includes('>')) continue
    const clean = decodeURIComponent(target.split('#')[0].split('?')[0])
    if (!clean) continue
    const isLink = target === clean && text.includes('](' + target + ')')
    const resolved = clean.startsWith('/') || !isLink
      ? path.join(root, clean)
      : path.resolve(path.dirname(file), clean)
    if (!await exists(resolved)) problems.push(relative + ' -> ' + target)
  }
}

if (problems.length > 0) {
  console.error('check-docs: ' + problems.length + ' broken reference(s)\n' + problems.map((line) => '  ' + line).join('\n'))
  process.exit(1)
}
console.log('check-docs: ' + files.length + ' markdown files, no broken references')
