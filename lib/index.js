/**
 * dsh-bot-team-tab — host half.
 *
 * The plugin itself lives in the browser (./lib/client.js). This half exists for
 * two reasons: the profile's Loader row names the package, so the package must
 * resolve a host module, and the browser needs somewhere to write down what it
 * did. It registers exactly one route:
 *
 *   POST /api/bot-team/log   { t, v, event, data }  -> one JSON line on disk
 *
 * Lines land in `~/.dsh/logs/dsh-bot-team-tab.log` (override: DSH_BOT_TEAM_LOG).
 * When a click on a Bot row does nothing, that file says which step was reached
 * and what the runtime answered — instead of guessing from the window.
 *
 * No tool, no service, no state: nothing here touches DS Bot or the workspace.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export const name = 'dsh-bot-team-tab'

/** The shared HTTP channel the /api routes live on. */
export const inject = ['connection']

/** Where the browser-side log lines are posted. */
export const LOG_ROUTE = '/api/bot-team/log'

/** One line's ceiling, in bytes: a runaway payload must not fill the disk. */
const MAX_LINE = 16384

/** Absolute path of the log file, honouring DSH_BOT_TEAM_LOG. */
export function logPath() {
  const override = process.env.DSH_BOT_TEAM_LOG
  if (typeof override === 'string' && override.trim() !== '') return override
  return path.join(homedir(), '.dsh', 'logs', 'dsh-bot-team-tab.log')
}

export function apply(ctx) {
  const file = logPath()
  let pending = Promise.resolve()

  const write = (line) => {
    pending = pending.then(async () => {
      try {
        await mkdir(path.dirname(file), { recursive: true })
        await appendFile(file, line + '\n', 'utf8')
      } catch {
        // A log that cannot be written must not affect the page.
      }
    })
  }

  const connection = ctx.connection ?? (typeof ctx.get === 'function' ? ctx.get('connection') : undefined)
  const register = connection?.fetch?.register
  if (typeof register !== 'function') return

  ctx.effect(() => register({
    path: LOG_ROUTE,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body
      try {
        body = await request.json()
      } catch {
        body = undefined
      }
      if (body !== null && typeof body === 'object') {
        const line = JSON.stringify({
          at: new Date().toISOString(),
          pid: process.pid,
          v: body.v ?? null,
          event: String(body.event ?? ''),
          clientAt: body.t ?? null,
          data: body.data ?? null,
        })
        if (line.length <= MAX_LINE) write(line)
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  }), 'dsh-bot-team-tab: client log route')
}
