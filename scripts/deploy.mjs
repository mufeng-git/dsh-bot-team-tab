#!/usr/bin/env node
/**
 * Install this plugin into a DSH profile and verify what actually landed.
 * The verification matters: a version that installs but reports an older
 * VERSION in the host log has burned us before (0.4.0 shipped as 0.3.4).
 *
 *   node scripts/deploy.mjs [--profile desktop] [--spec github:owner/repo#v0.4.3]
 *                           [--dsh path/to/dsh.cmd] [--no-install]
 *
 * Needs write access to ~/.dsh/profiles/<profile>. Exits non-zero when the
 * installed copy does not match this working tree.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const has = (name) => argv.includes('--' + name)

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const profile = flag('profile', 'desktop')
const slug = (pkg.repository?.url ?? '').replace(/^git\+/, '').replace(/\.git$/, '').split('github.com/')[1]
const spec = flag('spec', slug ? 'github:' + slug + '#v' + pkg.version : '')
const dsh = flag('dsh', process.env.DSH_CLI ?? 'D:/soft/dhs/resources/runtime/cli/bin/dsh.cmd')
const home = homedir()
const installed = path.join(home, '.dsh', 'profiles', profile, 'node_modules', pkg.name)

if (!has('no-install')) {
  if (!spec) { console.error('deploy: no spec; pass --spec or add repository.url to package.json'); process.exit(2) }
  console.log('deploy: ' + dsh + ' plugin --profile ' + profile + ' add ' + spec)
  const result = spawnSync(dsh, ['plugin', '--profile', profile, 'add', spec], { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.error) {
    console.error('deploy: could not start the DSH CLI (' + result.error.code + ')')
    console.error('deploy: run it yourself, then re-run with --no-install')
    console.error('  dsh plugin --profile ' + profile + ' add ' + spec)
    process.exit(1)
  }
  if (result.status !== 0) { console.error('deploy: the CLI exited with ' + result.status); process.exit(1) }
}

let localPkg
let installedPkg
try {
  localPkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  installedPkg = JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8'))
} catch {
  console.error('deploy: ' + installed + ' is missing package.json')
  process.exit(1)
}

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex')
const localClient = await readFile(path.join(root, 'lib', 'client.js'))
const installedClient = await readFile(path.join(installed, 'lib', 'client.js'))
const localSha = sha(localClient)
const installedSha = sha(installedClient)
const versionConstant = /const VERSION = '([^']+)'/.exec(localClient.toString('utf8'))?.[1]

const checks = [
  ['profile version', installedPkg.version, localPkg.version],
  ['lib/client.js', installedSha, localSha],
  ['VERSION constant', versionConstant, localPkg.version],
]
let failed = 0
for (const [label, actual, expected] of checks) {
  const ok = actual === expected
  if (!ok) failed += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + label + ': ' + actual + (ok ? '' : ' (expected ' + expected + ')'))
}
console.log('deploy: ' + installed)
if (failed > 0) { console.error('deploy: ' + failed + ' mismatch(es)'); process.exit(1) }
console.log('deploy: now quit DSH completely and start it again — the client bundle loads at launch, a page reload is not enough')
