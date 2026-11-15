/**
 * dsh-bot-team-tab - client half (browser bundle).
 *
 * One left-rail row per DS Bot teammate, labelled with the Bot's own name. Click
 * a row and the workspace switches to that Bot's session - no landing page, no
 * settings row.
 *
 * Slots used:
 *   sidebar.panellist            one row per Bot, ordered under 「新建会话」
 *   main                         the page a row selects; for a Bot row it opens
 *                                that Bot's session and steps out of the way
 *   sidebar.session.row.trailing a quiet BOT chip on Bot sessions
 *
 * Every field the endpoint returns is optional: a missing name falls back to the
 * id, a missing session leaves a notice instead of throwing.
 */

window.__ModuleLoader__.load({
  id: 'dsh-bot-team-tab',

  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useCallback = React.useCallback
    const useSyncExternalStore = React.useSyncExternalStore

    const ROUTE = 'api/bot'
    const ROW_PREFIX = 'zdhcs:bot:'
    const ROW_ORDER = -1
    const POLL_MS = 5000
    const BACKOFF_MS = [5000, 10000, 20000, 30000]

    const DICT = {
      zh: {
        noSession: '这个 Bot 还没有会话。',
        openFailed: '打开会话失败：',
        loading: '正在打开会话…',
        unreachable: '连不上 DS Bot。',
      },
      en: {
        noSession: 'This Bot has no session yet.',
        openFailed: 'Could not open the session: ',
        loading: 'Opening the session…',
        unreachable: 'DS Bot is unreachable.',
      },
    }

    function pickLang(ctx) {
      let lang = ''
      try {
        if (ctx && ctx.locale && typeof ctx.locale.get === 'function') lang = String(ctx.locale.get() || '')
      } catch (err) { lang = '' }
      if (!lang && typeof document !== 'undefined') {
        const root = document.documentElement
        lang = root && root.lang ? String(root.lang) : ''
      }
      return /^en/i.test(lang) ? 'en' : 'zh'
    }

    function t(ctx, key) {
      const dict = DICT[pickLang(ctx)] || DICT.zh
      return dict[key] !== undefined ? dict[key] : key
    }

    function normalize(payload) {
      const raw = payload && typeof payload === 'object' ? payload : {}
      const list = Array.isArray(raw.bots) ? raw.bots : []
      const bots = []
      const seen = Object.create(null)
      for (let i = 0; i < list.length; i += 1) {
        const bot = list[i]
        if (!bot || typeof bot !== 'object') continue
        const id = String(bot.id != null ? bot.id : bot.name != null ? bot.name : 'bot-' + i)
        if (seen[id]) continue
        seen[id] = true
        const sessionId = bot.sessionId != null ? bot.sessionId : bot.currentSessionId
        bots.push({
          id,
          name: bot.name != null ? String(bot.name) : id,
          sessionId: sessionId != null ? String(sessionId) : '',
          state: bot.state != null ? String(bot.state) : '',
        })
      }
      return { bots, mainBotId: raw.mainBotId != null ? String(raw.mainBotId) : '', ok: true, error: '' }
    }

    function createStore() {
      let snapshot = { bots: [], mainBotId: '', ok: false, error: '' }
      const listeners = new Set()
      const emit = () => {
        listeners.forEach((fn) => {
          try { fn() } catch (err) { /* one broken listener must not stop the rest */ }
        })
      }
      return {
        get: function () { return snapshot },
        set: function (next) {
          const merged = {
            bots: next.bots || snapshot.bots,
            mainBotId: next.mainBotId !== undefined ? next.mainBotId : snapshot.mainBotId,
            ok: next.ok !== undefined ? next.ok : snapshot.ok,
            error: next.error !== undefined ? next.error : snapshot.error,
          }
          const same = merged.ok === snapshot.ok &&
            merged.error === snapshot.error &&
            merged.mainBotId === snapshot.mainBotId &&
            JSON.stringify(merged.bots) === JSON.stringify(snapshot.bots)
          snapshot = merged
          if (!same) emit()
        },
        subscribe: function (fn) {
          listeners.add(fn)
          return function () { listeners.delete(fn) }
        },
      }
    }

    /**
     * The DS Bot route answers in one envelope: { ok: true, value } or
     * { ok: false, error: { code, message } }. Everything below works on the value.
     */
    function unwrap(answer) {
      if (!answer || typeof answer !== 'object') return {}
      if (answer.ok === false) {
        const detail = answer.error && (answer.error.message || answer.error.code)
        throw new Error(detail ? String(detail) : 'bot/error')
      }
      return answer.value !== undefined ? answer.value : answer
    }

    function useStore(store) {
      const getSnapshot = useCallback(function () { return store.get() }, [store])
      return useSyncExternalStore(store.subscribe, getSnapshot)
    }

    const STYLE_ID = 'dsh-bot-rows-style'
    const CSS = [
      '.dbr_page{box-sizing:border-box;height:100%;min-height:0;overflow-y:auto;display:flex;flex-direction:column;align-items:center;padding:28px clamp(24px,4vw,48px) 48px}',
      '.dbr_page>*{width:100%;max-width:760px}',
      '.dbr_notice{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
      '.dbr_badge{font-size:9px;font-weight:600;letter-spacing:.04em;line-height:14px;padding:0 4px;border-radius:3px;color:var(--dsw-alias-label-secondary);border:0.5px solid var(--dsw-alias-border-l2)}',
    ].join('')

    function installStyles() {
      if (typeof document === 'undefined' || !document.createElement) return
      if (document.getElementById(STYLE_ID)) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = CSS
      const root = document.head || document.documentElement
      if (root && root.appendChild) root.appendChild(style)
    }

    function BotIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 16
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 2.75, y: 3.75, width: 10.5, height: 8.5, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.25 }),
        h('circle', { cx: 6, cy: 8, r: 1, fill: 'currentColor' }),
        h('circle', { cx: 10, cy: 8, r: 1, fill: 'currentColor' }),
        h('path', { d: 'M8 3.75V2.5', stroke: 'currentColor', strokeWidth: 1.25, strokeLinecap: 'round' })
      )
    }

    /**
     * The page a Bot row selects. Mounting it means the user clicked that Bot, so
     * it does the one thing a click should do - open the session - and then hands
     * the main area back with selectPanel(null).
     */
    function JumpPanel(props) {
      const ctx = props.ctx
      const store = props.store
      const botId = props.botId
      const snap = useStore(store)
      const bot = snap.bots.filter(function (b) { return b.id === botId })[0] || null
      const sessionId = bot ? bot.sessionId : ''
      const message = useState('')
      const setMessage = message[1]

      useEffect(function () {
        if (!bot) return
        const workspace = ctx.uiWorkspace || (ctx.get && ctx.get('uiWorkspace'))
        const layout = (ctx.get && ctx.get('layout')) || null
        const back = function () {
          try { if (layout && typeof layout.selectPanel === 'function') layout.selectPanel(null) } catch (err) { /* nothing to restore */ }
        }
        if (!sessionId) {
          setMessage(t(ctx, 'noSession'))
          return
        }
        if (workspace && typeof workspace.openSession === 'function') {
          try {
            workspace.openSession(sessionId)
            back()
            return
          } catch (err) {
            setMessage(t(ctx, 'openFailed') + String((err && err.message) || err))
            return
          }
        }
        setMessage(t(ctx, 'openFailed') + t(ctx, 'unreachable'))
      }, [botId, sessionId])

      return h('div', { className: 'dbr_page' }, h('div', { className: 'dbr_notice' }, message[0] || t(ctx, 'loading')))
    }

    function SessionBadge(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : ''
      const store = props && props.store
      const snap = useStore(store)
      if (!sessionId) return null
      const bot = snap.bots.filter(function (b) { return b.sessionId === sessionId })[0]
      if (!bot) return null
      return h('span', { className: 'dbr_badge', title: 'Bot : ' + bot.name }, 'BOT')
    }

    return {
      inject: ['slots'],

      apply(ctx) {
        const slots = ctx.slots
        if (!slots || typeof slots.register !== 'function') {
          console.warn('[dsh-bot-team-tab] slots service unavailable; no left-rail rows registered')
          return
        }

        const store = createStore()

        ctx.effect(function () {
          installStyles()
          let stopped = false
          let failures = 0
          let timer = null

          const schedule = function (ms) {
            if (stopped) return
            timer = setTimeout(poll, ms)
          }

          const fail = function (err) {
            store.set({ ok: false, error: String((err && err.message) || err) })
            const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]
            failures += 1
            schedule(wait)
          }

          const poll = function () {
            if (stopped) return
            let pending = null
            try {
              pending = fetch(ROUTE, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ endpoint: 'state', payload: {} }),
              })
            } catch (err) {
              fail(err)
              return
            }
            pending
              .then(function (res) {
                if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status))
                return res.json()
              })
              .then(function (answer) {
                failures = 0
                store.set(normalize(unwrap(answer)))
                schedule(POLL_MS)
              })
              .catch(fail)
          }

          poll()
          return function () {
            stopped = true
            if (timer !== null) clearTimeout(timer)
            timer = null
          }
        }, 'dsh-bot-team-tab: state poll')

        // A row and its page are created and disposed together: the shell refuses
        // to select a row whose page is missing, so the page goes in first.
        ctx.effect(function () {
          const rows = new Map()
          const pages = new Map()

          const ensure = function (bot) {
            const id = ROW_PREFIX + bot.id
            if (!pages.has(id)) {
              pages.set(id, slots.inject('main', function () {
                return slots.register(
                  { name: 'main', key: id, inject: function () { return { ctx: ctx, store: store, botId: bot.id } } },
                  JumpPanel
                )
              }))
            }
            if (!rows.has(id)) {
              rows.set(id, slots.inject('sidebar.panellist', function () {
                return slots.register(
                  {
                    name: 'sidebar.panellist',
                    id: id,
                    order: ROW_ORDER,
                    label: function () {
                      const live = store.get().bots.filter(function (b) { return b.id === bot.id })[0]
                      return live ? live.name : bot.name
                    },
                  },
                  BotIcon
                )
              }))
            }
          }

          const drop = function (id) {
            const row = rows.get(id)
            if (row) {
              try { row() } catch (err) { /* already gone */ }
              rows.delete(id)
            }
            const page = pages.get(id)
            if (page) {
              try { page() } catch (err) { /* already gone */ }
              pages.delete(id)
            }
          }

          const sync = function () {
            const snap = store.get()
            const wanted = new Set()
            snap.bots.forEach(function (bot) {
              wanted.add(ROW_PREFIX + bot.id)
              ensure(bot)
            })
            Array.from(rows.keys()).forEach(function (id) {
              if (!wanted.has(id)) drop(id)
            })
          }

          const unsubscribe = store.subscribe(sync)
          sync()

          return function () {
            unsubscribe()
            Array.from(rows.keys()).forEach(drop)
          }
        }, 'dsh-bot-team-tab: rail rows')

        ctx.effect(function () {
          const dispose = slots.inject('sidebar.session.row.trailing', function () {
            return slots.register(
              { name: 'sidebar.session.row.trailing', id: 'zdhcs:bot-badge', inject: function () { return { store: store } } },
              SessionBadge
            )
          })
          return function () {
            try { dispose() } catch (err) { /* already gone */ }
          }
        }, 'dsh-bot-team-tab: session badge')
      },

      __internals: { normalize: normalize, unwrap: unwrap, DICT: DICT, ROW_PREFIX: ROW_PREFIX, ROW_ORDER: ROW_ORDER, POLL_MS: POLL_MS, BACKOFF_MS: BACKOFF_MS },
    }
  },
})

