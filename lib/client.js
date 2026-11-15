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
 * How a click becomes a session switch: the sidebar selects the panel whose id
 * the row registered, so the jump hangs off the layout's panel selection
 * (ctx.get('layout').panelInfo) instead of off a component mounting - a page
 * that only exists to redirect is one render away from never running.
 *
 * Every step of that chain writes a line to the host log at
 * ~/.dsh/logs/dsh-bot-team-tab.log (route: POST api/bot-team/log), so a click
 * that does nothing can be read back from disk instead of guessed at.
 */

window.__ModuleLoader__.load({
  id: 'dsh-bot-team-tab',

  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useEffect = React.useEffect
    const useCallback = React.useCallback
    const useSyncExternalStore = React.useSyncExternalStore

    const VERSION = '0.3.4'
    const ROUTE = 'api/bot'
    const LOG_ROUTE = 'api/bot-team/log'
    const ROW_PREFIX = 'zdhcs:bot:'
    const ROW_ORDER = -1
    const POLL_MS = 5000
    const BACKOFF_MS = [5000, 10000, 20000, 30000]

    const DICT = {
      zh: {
        noSession: '这个 Bot 还没有会话。',
        openFailed: '打开会话失败：',
        opening: '正在打开会话…',
        unreachable: '连不上 DS Bot。',
      },
      en: {
        noSession: 'This Bot has no session yet.',
        openFailed: 'Could not open the session: ',
        opening: 'Opening the session…',
        unreachable: 'DS Bot is unreachable.',
      },
    }

    /** Fire-and-forget line for the host log; it must never break the UI. */
    function log(event, data) {
      try {
        if (typeof fetch !== 'function') return
        const answer = fetch(LOG_ROUTE, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ t: Date.now(), v: VERSION, event: event, data: data === undefined ? null : data }),
        })
        if (answer && typeof answer.catch === 'function') answer.catch(function () {})
      } catch (err) { /* a missing log route is not a plugin failure */ }
    }

    function describe(err) {
      return String((err && err.message) || err)
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

    /** The runtime faces, probed at call time: a service may arrive late. */
    function facesOf(ctx) {
      const read = function (name) {
        try {
          if (ctx && ctx[name] !== undefined) return ctx[name]
          if (ctx && typeof ctx.get === 'function') return ctx.get(name)
        } catch (err) { /* absent service */ }
        return null
      }
      return {
        workspace: read('uiWorkspace'),
        layout: read('layout'),
      }
    }

    function faceReport(faces) {
      return {
        openSession: !!(faces.workspace && typeof faces.workspace.openSession === 'function'),
        selectPanel: !!(faces.layout && typeof faces.layout.selectPanel === 'function'),
        panelInfo: !!(faces.layout && faces.layout.panelInfo && typeof faces.layout.panelInfo.subscribe === 'function'),
      }
    }

    /** Services the click path needs; named once so the probes stay honest. */
    const SERVICE_NAMES = ['uiWorkspace', 'layout']

    /**
     * A tiny observable holder for the injected service scope. The shell hands
     * services to a plugin through `ctx.inject`, and that scope may arrive after
     * apply() runs or be replaced later, so the reference is kept live instead of
     * being read once.
     */
    function createScopeStore() {
      let value = null
      const listeners = new Set()
      return {
        get: function () { return value },
        set: function (next) {
          if (next === value) return
          value = next
          listeners.forEach(function (listener) {
            try { listener() } catch (err) { /* a listener must not break the scope */ }
          })
        },
        subscribe: function (listener) {
          listeners.add(listener)
          return function () { listeners.delete(listener) }
        },
      }
    }

    /** What a context actually resolves, for the host log. */
    function probeServices(source) {
      const out = { get: false, inject: false, direct: {}, resolved: {} }
      try { out.get = !!(source && typeof source.get === 'function') } catch (err) { out.get = false }
      try { out.inject = !!(source && typeof source.inject === 'function') } catch (err) { out.inject = false }
      SERVICE_NAMES.forEach(function (name) {
        let value = null
        try { value = source ? source[name] : null } catch (err) { value = null }
        out.direct[name] = !!value
        if (!value && out.get) {
          try { value = source.get(name) } catch (err) { value = null }
        }
        out.resolved[name] = value
          ? Object.keys(value).filter(function (key) { return typeof value[key] === 'function' }).slice(0, 8).join('|')
          : null
      })
      return out
    }

    /**
     * The runtime faces the click path needs. Services a plugin did not declare
     * in its module-level `inject` list are reached with `ctx.inject`: it yields
     * a scope that resolves them, waits until they exist, and re-runs when they
     * are replaced.
     */
    function createServices(ctx, scopeStore) {
      let integration = null
      if (ctx && typeof ctx.inject === 'function') {
        try {
          integration = ctx.inject(SERVICE_NAMES, function (injected) {
            scopeStore.set(injected)
            log('services:ready', { probe: probeServices(injected), faces: faceReport(facesOf(injected)) })
            return function () {
              if (scopeStore.get() === injected) scopeStore.set(null)
              log('services:gone', {})
            }
          })
        } catch (err) {
          log('services:inject:error', { message: describe(err) })
          integration = null
        }
      } else {
        log('services:no-inject', { probe: probeServices(ctx) })
      }
      return {
        faces: function () { return facesOf(scopeStore.get() || ctx) },
        dispose: function () {
          try { if (integration && typeof integration.dispose === 'function') integration.dispose() } catch (err) { /* already gone */ }
        },
      }
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
     * Open one Bot's session, leaving whatever panel is selected first. Returns
     * the message to show on the panel page, or '' when the jump went through.
     */
    function createNavigator(ctx, store, services) {
      let inFlight = ''

      const leavePanel = function (layout) {
        try {
          const info = layout && layout.panelInfo
          const active = info && typeof info.getSnapshot === 'function' ? info.getSnapshot().activePanelId : undefined
          if (active !== undefined && active !== null && typeof layout.selectPanel === 'function') {
            layout.selectPanel(null)
            log('jump:leftPanel', { was: String(active) })
          }
        } catch (err) {
          log('jump:leftPanel:error', { message: describe(err) })
        }
      }

      const open = function (botId, via) {
        const bot = store.get().bots.filter(function (b) { return b.id === botId })[0] || null
        const faces = services.faces()
        log('jump:start', { via: via, botId: botId, hasBot: !!bot, sessionId: bot ? bot.sessionId : '', faces: faceReport(faces) })
        if (!bot) return t(ctx, 'noSession')
        if (!bot.sessionId) return t(ctx, 'noSession')
        const workspace = faces.workspace
        if (!workspace || typeof workspace.openSession !== 'function') {
          log('jump:noWorkspace', {})
          return t(ctx, 'openFailed') + t(ctx, 'unreachable')
        }
        leavePanel(faces.layout)
        if (inFlight === bot.sessionId) return ''
        inFlight = bot.sessionId
        try {
          workspace.openSession(bot.sessionId)
          log('jump:opened', { botId: botId, sessionId: bot.sessionId })
          return ''
        } catch (err) {
          log('jump:openSession:error', { botId: botId, sessionId: bot.sessionId, message: describe(err) })
          return t(ctx, 'openFailed') + describe(err)
        } finally {
          setTimeout(function () { if (inFlight === bot.sessionId) inFlight = '' }, 1000)
        }
      }

      return { open: open }
    }

    /**
     * The page a Bot row selects. The navigation itself hangs off the layout's
     * panel selection, so this page only reports; if the subscription could not
     * be installed, mounting the page is the fallback trigger.
     */
    function JumpPanel(props) {
      const ctx = props.ctx
      const store = props.store
      const botId = props.botId
      const watched = props.watched === true
      const navigate = props.navigate
      const scopeStore = props.scope
      const snap = useStore(store)
      const scope = scopeStore ? useStore(scopeStore) : null
      const ready = !!scope
      const bot = snap.bots.filter(function (b) { return b.id === botId })[0] || null
      const message = React.useState('')
      const setMessage = message[1]

      useEffect(function () {
        log('panel:mount', { botId: botId, watched: watched, ready: ready })
        if (watched || !bot || !ready) return
        const text = navigate(botId, 'mount')
        if (text) setMessage(text)
      }, [botId, watched, ready])

      return h('div', { className: 'dbr_page' }, h('div', { className: 'dbr_notice' }, message[0] || t(ctx, 'opening')))
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
        log('apply:start', { version: VERSION })
        try {
          applyPlugin(ctx)
          log('apply:done', {})
        } catch (err) {
          log('apply:error', { message: describe(err), stack: String((err && err.stack) || '') })
          throw err
        }

        function applyPlugin(ctx) {
          const slots = ctx.slots
          log('apply:slots', {
            present: !!slots,
            register: !!(slots && typeof slots.register === 'function'),
            inject: !!(slots && typeof slots.inject === 'function'),
            faces: faceReport(facesOf(ctx)),
          })
          if (!slots || typeof slots.register !== 'function' || typeof slots.inject !== 'function') {
            log('apply:slots:missing', {})
            return
          }

          const store = createStore()
          const scopeStore = createScopeStore()
          const services = createServices(ctx, scopeStore)
          ctx.effect(function () { return function () { services.dispose() } }, 'dsh-bot-team-tab: services')
          const navigator = createNavigator(ctx, store, services)
          const navigate = function (botId, via) { return navigator.open(botId, via) }

          // The click path: the sidebar selects our panel id, and this watcher opens
          // the Bot's session. It re-attaches whenever the service scope appears or
          // is replaced, and defers out of the notification so the layout store is
          // not re-entered while it is still settling.
          let watched = false
          ctx.effect(function () {
            let stop = null
            const attach = function () {
              if (stop) {
                try { stop() } catch (err) { /* already gone */ }
                stop = null
              }
              watched = false
              const faces = services.faces()
              const info = faces.layout && faces.layout.panelInfo
              if (!info || typeof info.subscribe !== 'function' || typeof info.getSnapshot !== 'function') {
                log('panel:watch:unavailable', { faces: faceReport(faces) })
                return
              }
              watched = true
              let last = String((info.getSnapshot() || {}).activePanelId ?? '')
              log('panel:watch:ready', { active: last })
              const unsubscribe = info.subscribe(function () {
                let id = ''
                try { id = String((info.getSnapshot() || {}).activePanelId ?? '') } catch (err) { id = '' }
                if (id === last) return
                last = id
                log('panel:change', { id: id === '' ? null : id })
                if (id.indexOf(ROW_PREFIX) !== 0) return
                const botId = id.slice(ROW_PREFIX.length)
                setTimeout(function () { navigate(botId, 'watch') }, 0)
              })
              stop = function () {
                watched = false
                try { unsubscribe() } catch (err) { /* already gone */ }
              }
            }
            attach()
            const off = scopeStore.subscribe(attach)
            return function () {
              off()
              if (stop) {
                try { stop() } catch (err) { /* already gone */ }
              }
            }
          }, 'dsh-bot-team-tab: panel watcher')

          ctx.effect(function () {
            installStyles()
            let stopped = false
            let failures = 0
            let timer = null
            let lastLogged = ''

            const schedule = function (ms) {
              if (stopped) return
              timer = setTimeout(poll, ms)
            }

            const fail = function (err) {
              const message = describe(err)
              log('poll:error', { message: message })
              store.set({ ok: false, error: message })
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
                  const next = normalize(unwrap(answer))
                  const stamp = next.bots.map(function (b) { return b.id + '=' + b.sessionId }).join(',')
                  if (stamp !== lastLogged) {
                    lastLogged = stamp
                    log('poll:ok', { bots: stamp })
                  }
                  store.set(next)
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
                  const dispose = slots.register(
                    { name: 'main', key: id, inject: function () { return { ctx: ctx, store: store, botId: bot.id, watched: watched, navigate: navigate, scope: scopeStore } } },
                    JumpPanel
                  )
                  log('main:register', { key: id })
                  return dispose
                }))
              }
              if (!rows.has(id)) {
                rows.set(id, slots.inject('sidebar.panellist', function () {
                  const dispose = slots.register(
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
                  log('row:register', { id: id, name: bot.name })
                  return dispose
                }))
              }
            }

            const drop = function (id) {
              log('row:drop', { id: id })
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
        }
      },

      __internals: { normalize: normalize, unwrap: unwrap, log: log, DICT: DICT, VERSION: VERSION, ROW_PREFIX: ROW_PREFIX, ROW_ORDER: ROW_ORDER, POLL_MS: POLL_MS, BACKOFF_MS: BACKOFF_MS },
    }
  },
})
