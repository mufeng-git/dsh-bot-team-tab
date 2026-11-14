/**
 * dsh-bot-team-tab — host half.
 *
 * Intentionally empty: the whole plugin lives in the browser (./lib/client.js).
 * This file exists for one reason only — the profile's Loader row names the
 * package, so the package must resolve a module on the host side. It registers
 * no tool, no route, no service, and reads nothing: the roster comes from
 * DS Bot's own `api/bot` endpoint, called from the page itself.
 */

export const name = 'dsh-bot-team-tab'

/** No host-side service is required. */
export const inject = []

export function apply() {
  // Nothing to do on the host. See lib/client.js.
}
