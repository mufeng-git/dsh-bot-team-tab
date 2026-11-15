/**
 * Loads lib/client.js the way the browser does and hands back a stub plugin
 * context, so the suite can check registration and navigation without a GUI.
 *
 *   window.__ModuleLoader__.load({ factory })  -> the bundle
 *   require('react')                           -> a tiny element stub
 *   ctx.inject(names, cb)                      -> the injected service scope
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = path.dirname(fileURLToPath(import.meta.url))
export const root = path.join(here, '..')
const clientPath = path.join(root, 'lib', 'client.js')

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

/** Evaluate the bundle against stub globals; returns the module exports. */
export async function loadBundle() {
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
  if (!exported || typeof exported.apply !== 'function' || !exported.__internals) {
    throw new Error('the bundle must export apply() and __internals')
  }
  return exported
}

// Bound now: installClock() replaces globalThis.setTimeout, and a tick that went
// through the fake clock would wait for a flush that only a tick can cause.
const realSetTimeout = globalThis.setTimeout.bind(globalThis)
export const tick = (ms = 20) => new Promise((resolve) => realSetTimeout(resolve, ms))

/**
 * One harness per test file. options:
 *   bots        the roster the stub api/bot answers with
 *   openSession overrides uiWorkspace.openSession (e.g. to make it throw)
 *   selectPanel overrides layout.selectPanel
 *   apiFails    makes api/bot reject, to exercise the poll error path
 */
export async function createHarness(options = {}) {
  const exported = await loadBundle()
  const roster = { bots: options.bots || [] }
  const logs = []
  const registered = []
  const opened = []
  const selected = []
  const listeners = new Set()
  let activePanelId = ''

  const panelInfo = {
    getSnapshot: () => ({ activePanelId }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  const scope = {
    uiWorkspace: options.noWorkspace ? undefined : {
      openSession: options.openSession || ((sessionId) => { opened.push(sessionId) }),
    },
    layout: {
      selectPanel: options.selectPanel || ((id) => { selected.push(id) }),
      panelInfo,
    },
    get(name) { return this[name] ?? null },
  }

  const reply = (body) => ({ ok: true, json: async () => body })

  globalThis.fetch = async (url, init) => {
    const target = String(url)
    const body = init && init.body ? JSON.parse(String(init.body)) : null
    if (target.endsWith('api/bot-team/log')) {
      logs.push(body)
      return reply({ ok: true })
    }
    if (options.apiFails) throw new Error('offline')
    return reply({ ok: true, value: { bots: roster.bots } })
  }

  const ctx = {
    slots: {
      register: (options, component) => {
        const entry = Object.assign({}, options, { component })
        registered.push(entry)
        // A real slot registry removes the entry when its disposer runs; keep
        // that behaviour so a dropped row can be asserted on.
        return () => {
          const index = registered.indexOf(entry)
          if (index >= 0) registered.splice(index, 1)
        }
      },
      inject: (name, factory) => factory(),
    },
    effect: (factory) => {
      const dispose = factory()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    get: () => null,
    inject: (names, callback) => {
      const cleanup = callback(scope)
      return { dispose: () => { if (typeof cleanup === 'function') cleanup() } }
    },
  }

  return {
    exported,
    internals: exported.__internals,
    ctx,
    scope,
    registered,
    opened,
    selected,
    logs,
    panelInfo,
    setBots(bots) { roster.bots = bots },
    /** Simulates the sidebar selecting a row. */
    selectRow(id) {
      activePanelId = id
      listeners.forEach((listener) => listener())
    },
    events() { return logs.map((line) => line && line.event) },
  }
}

/** Installs a fake setTimeout so a poll tick can be stepped deterministically. */
export function installClock() {
  const real = globalThis.setTimeout
  let queue = []
  let seq = 0
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const id = ++seq
    queue.push({ id, fn, rest })
    return id
  }
  globalThis.clearTimeout = (id) => { queue = queue.filter((job) => job.id !== id) }
  return {
    /** Runs the timers queued so far; timers added meanwhile wait for the next flush. */
    async flush() {
      const batch = queue
      queue = []
      for (const job of batch) job.fn(...job.rest)
      await tick(10)
    },
    pending() { return queue.length },
    restore() {
      globalThis.setTimeout = real
    },
  }
}
