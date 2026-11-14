/**
 * dsh-bot-team-tab — client half (browser bundle).
 *
 * This file is what `exports["./client"]` points at: a self-registering lazy
 * factory that `window.__ModuleLoader__` picks up in the browser.
 *
 * What it is: one better-sidebar tab that lists the DS Bot teammates and, for
 * each, what it is doing, what it is stuck on and who it is waiting for.
 *
 * Constraints this file obeys on purpose:
 *
 *  - it requires only platform modules (`react`); nothing is imported from
 *    another client package, so nothing needs external wiring;
 *  - it reads exactly one thing — DS Bot's own `api/bot` state endpoint, from
 *    the page, with the user's own cookies. It never touches DS Bot's React
 *    store, never writes to DS Bot, and never caches anything to disk;
 *  - the fetch path is document-relative (`api/bot`, not `/api/bot`): the GUI
 *    serves the app under `<base href="./">`, so a root-absolute path would
 *    escape the prefix in a sub-path deployment;
 *  - every field the endpoint returns is treated as optional. When DS Bot
 *    changes a shape, a row degrades (a missing name shows its id, a missing
 *    stage shows the plain state) instead of throwing;
 *  - colors come from `--dsw-alias-*` theme tokens with plain fallbacks, so
 *    light and dark themes both work;
 *  - state is never carried by color alone: every row states its state in
 *    words and carries a distinct light shape.
 */

window.__ModuleLoader__.load({
  id: 'dsh-bot-team-tab',

  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useRef = React.useRef
    const useMemo = React.useMemo
    const useCallback = React.useCallback

    // ---------------------------------------------------------------- constants

    /** Tab type. The `zdhcs:` prefix keeps it out of anyone else's namespace. */
    const TAB_ID = 'zdhcs:bot-team'
    /** DS Bot's own state endpoint, relative to the document base. */
    const ROUTE = 'api/bot'
    /** The poll interval while the tab is visible. Never below 3s: see README. */
    const POLL_MS = 3000
    /** Backoff after consecutive failures; the last entry is the ceiling. */
    const BACKOFF_MS = [3000, 6000, 12000, 24000, 30000]
    /** How long a row keeps saying "just finished" after a clean turn ends. */
    const JUST_FINISHED_MS = 7000
    /** A blocking failure that has sat still this long dims to idle (keeping its !). */
    const STALE_FAIL_MS = 180000
    /** A group longer than this folds its tail behind a "show the rest" row. */
    const COLLAPSE_AT = 8
    const STYLE_ID = 'dsh-bot-team-tab-styles'
    const EMPTY_WORK = { bots: {}, approvals: [], waiting: {}, turns: {} }

    // ------------------------------------------------------------------- copy

    const DICT = {
      zh: {
        title: '团队',
        description: '每个 Bot 在做什么、在等谁',
        needsYou: '等你处理',
        needsPick: '等你选模型',
        approvalTail: '待批 ',
        working: '运行中',
        waitingBot: '等别的 Bot',
        waitingFor: '等 ',
        failed: '失败',
        failedWaiting: '等你修复',
        justFinished: '刚完成',
        idle: '闲置',
        ungrouped: '未分组',
        main: '主',
        empty: '还没有 Bot · 去 DS Bot 建一个',
        loadFailed: '取不到 Bot 状态',
        retry: '重试',
        stale: '最近一次刷新失败，显示的是上一次的状态',
        showRest: '展开其余 ',
        showRestTail: ' 个',
        collapse: '收起',
        switchingModel: '换模型',
        switchingFolder: '换工作目录',
        open: '打开会话',
        noSession: '这个 Bot 还没有会话',
        ago: '前',
        justNow: '刚刚',
        minute: ' 分钟',
        hour: ' 小时',
        day: ' 天',
        countLine: ' 个 Bot',
        workingCount: ' · ',
        workingCountTail: ' 个在跑',
      },
      en: {
        title: 'Team',
        description: 'What every Bot is doing, and who it waits for',
        needsYou: 'Needs you',
        needsPick: 'Pick its model',
        approvalTail: 'approvals ',
        working: 'Working',
        waitingBot: 'Waiting on a Bot',
        waitingFor: 'Waiting on ',
        failed: 'Failed',
        failedWaiting: 'needs a fix',
        justFinished: 'Just finished',
        idle: 'Idle',
        ungrouped: 'Ungrouped',
        main: 'Main',
        empty: 'No Bots yet — create one in DS Bot',
        loadFailed: 'Cannot read the Bot state',
        retry: 'Retry',
        stale: 'The last refresh failed; this is the previous state',
        showRest: 'Show the other ',
        showRestTail: '',
        collapse: 'Collapse',
        switchingModel: 'Switching model',
        switchingFolder: 'Switching folder',
        open: 'Open session',
        noSession: 'This Bot has no session',
        ago: ' ago',
        justNow: 'just now',
        minute: 'm',
        hour: 'h',
        day: 'd',
        countLine: ' Bots',
        workingCount: ' · ',
        workingCountTail: ' working',
      },
    }

    function pickLang(ctx) {
      try {
        const locale = ctx && ctx.locale
        const snap = locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot() : null
        const active = snap && (snap.active || snap.locale || snap.lang)
        if (typeof active === 'string' && active) return active.toLowerCase().indexOf('en') === 0 ? 'en' : 'zh'
      } catch (error) {
        /* a host without the locale service still gets a tab */
      }
      try {
        const nav = navigator && navigator.language
        if (typeof nav === 'string' && nav.toLowerCase().indexOf('en') === 0) return 'en'
      } catch (error) {
        /* no navigator: fall through */
      }
      return 'zh'
    }

    // ---------------------------------------------------------------- helpers

    /** The bot's own accent, or a stable color derived from its id. */
    const FALLBACK_INKS = ['#4D6BFE', '#10B981', '#F59E0B', '#EC2F6B', '#0AA8D6', '#8B5CF6', '#FF6900', '#14B8A6']
    function colorOf(bot) {
      const raw = bot && bot.color
      if (typeof raw === 'string' && raw) return raw
      if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0]) return raw[0]
      if (raw && typeof raw === 'object') {
        const named = raw.base || raw.ink || raw.value
        if (typeof named === 'string' && named) return named
      }
      const ink = bot && bot.avatar && (bot.avatar.ink || bot.avatar.color)
      if (typeof ink === 'string' && ink) return ink
      const id = String((bot && bot.id) || '')
      let hash = 0
      for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
      return FALLBACK_INKS[hash % FALLBACK_INKS.length]
    }

    function nameOf(bot) {
      if (bot && typeof bot.name === 'string' && bot.name) return bot.name
      if (bot && typeof bot.id === 'string' && bot.id) return bot.id
      return '?'
    }

    /** Every session id that belongs to this Bot's own chat. */
    function chatSessions(bot) {
      const ids = []
      if (bot && typeof bot.sessionId === 'string' && bot.sessionId) ids.push(bot.sessionId)
      if (bot && Array.isArray(bot.parts)) {
        for (const part of bot.parts) if (typeof part === 'string' && part) ids.push(part)
      }
      return ids
    }

    function sectionIdOf(bot) {
      const raw = bot && bot.section
      if (typeof raw === 'string' && raw) return raw
      if (raw && typeof raw === 'object' && raw.id !== undefined) return String(raw.id)
      return ''
    }

    function elapsedText(ms, d) {
      if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return ''
      const total = Math.floor(ms / 1000)
      if (total < 60) return total + 's'
      const minutes = Math.floor(total / 60)
      if (minutes < 60) return minutes + 'm ' + (total % 60) + 's'
      const hours = Math.floor(minutes / 60)
      return hours + 'h ' + (minutes % 60) + 'm'
    }

    function agoText(at, now, d) {
      if (typeof at !== 'number' || !isFinite(at) || at <= 0) return ''
      const ms = now - at
      if (ms < 45000) return d.justNow
      const minutes = Math.floor(ms / 60000)
      if (minutes < 60) return minutes + d.minute + d.ago
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return hours + d.hour + d.ago
      return Math.floor(hours / 24) + d.day + d.ago
    }

    /** What the newest running call is doing, in DS Bot's own words. */
    function stageOf(doing, d) {
      if (!doing || typeof doing !== 'object') return ''
      if (doing.switching) return doing.folder ? d.switchingFolder : d.switchingModel
      if (typeof doing.said === 'string' && doing.said) return doing.said
      const tool = typeof doing.tool === 'string' ? doing.tool : ''
      const target = typeof doing.target === 'string' ? doing.target : ''
      if (tool && target) return tool + ' · ' + target
      if (tool) return tool
      if (typeof doing.note === 'string' && doing.note) return doing.note
      return d.working
    }

    /**
     * The six states, in the order they win. `needsYou` and `working` are
     * decided by DS Bot's live answer; `justFinished` is this page's own memory
     * of a Bot leaving the working set; `failed` reads the Bot's own blocked
     * facts so a failure survives a reload of the page.
     */
    const STATE_ORDER = ['needsYou', 'working', 'waitingBot', 'failed', 'justFinished', 'idle']

    function classify(bot, view, now) {
      const work = view.work || EMPTY_WORK
      const id = String((bot && bot.id) || '')
      const sessions = chatSessions(bot)
      const sessionSet = new Set(sessions)

      // 1. needs-you: an approval sits open, or the Bot holds its greeting.
      if (bot && bot.waiting === true) return { state: 'needsYou', reason: 'pick' }
      const approvals = Array.isArray(work.approvals) ? work.approvals : []
      let open = 0
      for (const entry of approvals) {
        if (entry && typeof entry.sessionId === 'string' && sessionSet.has(entry.sessionId)) open += 1
      }
      if (open > 0) return { state: 'needsYou', reason: 'approval', counts: open }

      const waiting = work.waiting && typeof work.waiting === 'object' ? work.waiting[id] : undefined
      const waits = waiting && Array.isArray(waiting.waits) ? waiting.waits : []
      const names = []
      for (const item of waits) {
        const name = item && (item.name || item.to || item.room)
        if (typeof name === 'string' && name && names.indexOf(name) === -1) names.push(name)
      }

      // 2. working: the Bot runs a turn of its own chat.
      const doing = work.bots && typeof work.bots === 'object' ? work.bots[id] : undefined
      if (doing && typeof doing === 'object') {
        // A hand-off it is still waiting to get back outranks "working": the
        // group is the thing that is stalled, not this Bot's own turn.
        if (names.length > 0) return { state: 'waitingBot', names }
        return { state: 'working', doing }
      }

      // 3. waiting on another Bot, outside a turn.
      if (names.length > 0) return { state: 'waitingBot', names }

      // 4. failed: the Bot carries blocking facts only the user can fix.
      const blocked = bot && bot.blocked
      if (blocked && typeof blocked === 'object') {
        const at = typeof blocked.at === 'number' ? blocked.at : 0
        const code = typeof blocked.code === 'string' ? blocked.code : ''
        const stale = at > 0 && now - at > STALE_FAIL_MS
        return { state: stale ? 'idle' : 'failed', blocked: true, code, stale }
      }

      // 5. just finished, from this page's own memory.
      const finishedAt = view.justFinished && view.justFinished[id]
      if (typeof finishedAt === 'number' && now - finishedAt < JUST_FINISHED_MS) {
        return { state: 'justFinished' }
      }

      return { state: 'idle' }
    }

    function stateText(bot, verdict, now, d) {
      switch (verdict.state) {
        case 'needsYou':
          if (verdict.reason === 'pick') return d.needsPick
          return d.needsYou + (verdict.counts > 1 ? ' · ' + d.approvalTail + verdict.counts : '')
        case 'working': {
          const stage = stageOf(verdict.doing, d)
          const since = typeof verdict.doing.since === 'number' ? verdict.doing.since : 0
          const spent = since > 0 ? elapsedText(now - since, d) : ''
          if (stage && spent) return stage + ' · ' + spent
          return stage || spent || d.working
        }
        case 'waitingBot':
          return d.waitingFor + (verdict.names.length ? verdict.names.join('、') : d.waitingBot)
        case 'failed':
          return verdict.code ? d.failed + '（' + verdict.code + '） · ' + d.failedWaiting : d.failed + ' · ' + d.failedWaiting
        case 'justFinished':
          return d.justFinished
        default: {
          if (verdict.blocked && verdict.stale) {
            const ago = agoText(bot && bot.blocked && bot.blocked.at, now, d)
            return d.idle + (ago ? ' · ' + ago : '')
          }
          const preview = bot && typeof bot.preview === 'string' ? bot.preview : ''
          if (preview) return preview
          const ago = agoText(bot && bot.lastAt, now, d)
          return ago ? d.idle + ' · ' + ago : d.idle
        }
      }
    }

    /** Group the roster by DS Bot's sidebar sections; unknown sections fold last. */
    function buildGroups(bots, sections, d) {
      const known = []
      const seen = new Set()
      if (Array.isArray(sections)) {
        for (const section of sections) {
          if (!section || typeof section !== 'object' || section.id === undefined) continue
          const id = String(section.id)
          if (!id || seen.has(id)) continue
          seen.add(id)
          known.push({
            id,
            name: typeof section.name === 'string' && section.name ? section.name : id,
            order: typeof section.order === 'number' ? section.order : 0,
            bots: [],
          })
        }
      }
      known.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      const byId = new Map(known.map((group) => [group.id, group]))
      const loose = { id: '__ungrouped', name: d.ungrouped, order: 1e9, bots: [] }
      for (const bot of bots) {
        const id = sectionIdOf(bot)
        const group = id && byId.get(id) ? byId.get(id) : loose
        group.bots.push(bot)
      }
      const groups = known.filter((group) => group.bots.length > 0)
      if (loose.bots.length > 0) groups.push(loose)
      return groups
    }

    function openBot(ctx, bot) {
      const sessionId = bot && typeof bot.sessionId === 'string' ? bot.sessionId : ''
      if (!sessionId) return false
      const get = (service) => {
        try {
          return ctx && typeof ctx.get === 'function' ? ctx.get(service) : undefined
        } catch (error) {
          return undefined
        }
      }
      const workspace = ctx && ctx.uiWorkspace ? ctx.uiWorkspace : get('uiWorkspace')
      if (workspace && typeof workspace.openSession === 'function') {
        try {
          workspace.openSession(sessionId)
          return true
        } catch (error) {
          /* fall through to the sessions service */
        }
      }
      const sessions = ctx && ctx.sessions ? ctx.sessions : get('sessions')
      if (sessions) {
        for (const method of ['open', 'activate', 'openSession', 'focus']) {
          if (typeof sessions[method] === 'function') {
            try {
              sessions[method](sessionId)
              return true
            } catch (error) {
              /* try the next shape */
            }
          }
        }
      }
      return false
    }

    // ------------------------------------------------------------------ polling

    /**
     * One poll loop for the whole tab.
     *
     * It stops while the pane is hidden (either better-sidebar says so through
     * `visible`, or the browser tab is in the background), backs off on
     * consecutive failures, and does not re-render when DS Bot answers
     * `unchanged` with the same live key — the endpoint is not a pure read, so
     * the cheap answer is the one that matters.
     */
    function useRoster(ctx, active) {
      const [snapshot, setSnapshot] = useState({
        phase: 'loading',
        bots: [],
        sections: [],
        mainBotId: null,
        work: EMPTY_WORK,
        justFinished: {},
        failures: 0,
        error: null,
        revision: null,
        liveKey: null,
        modelsKey: null,
        at: 0,
      })
      const stoppedRef = useRef(false)

      useEffect(() => {
        if (!active) return undefined
        const lang = pickLang(ctx)
        let disposed = false
        let timer = null
        let controller = null
        let failures = 0
        let bots = []
        let sections = []
        let mainBotId = null
        let work = EMPTY_WORK
        let revision
        let liveKey
        let modelsKey
        let justFinished = {}
        let workingBefore = new Set()
        let firstAnswer = true

        const publish = (phase, error) => {
          if (disposed) return
          const nextWork = work && typeof work === 'object' ? work : EMPTY_WORK
          const running = nextWork.bots && typeof nextWork.bots === 'object' ? Object.keys(nextWork.bots).length : 0
          setSnapshot({
            phase,
            bots,
            sections,
            mainBotId,
            work: nextWork,
            justFinished,
            failures,
            error: error || null,
            revision: typeof revision === 'number' ? revision : null,
            liveKey: typeof liveKey === 'string' ? liveKey : null,
            modelsKey: typeof modelsKey === 'string' ? modelsKey : null,
            running,
            at: Date.now(),
          })
        }

        const schedule = (ms) => {
          if (disposed) return
          if (timer !== null) clearTimeout(timer)
          timer = setTimeout(run, ms)
        }

        const run = async () => {
          timer = null
          if (disposed) return
          let hidden = false
          try {
            hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
          } catch (error) {
            hidden = false
          }
          if (hidden) {
            schedule(POLL_MS)
            return
          }
          const payload = { locale: lang }
          if (typeof revision === 'number') payload.since = revision
          if (typeof modelsKey === 'string') payload.models = modelsKey
          if (typeof liveKey === 'string') payload.live = liveKey
          try {
            controller = typeof AbortController === 'function' ? new AbortController() : null
          } catch (error) {
            controller = null
          }
          let value
          try {
            const response = await fetch(ROUTE, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ endpoint: 'state', payload }),
              signal: controller ? controller.signal : undefined,
            })
            if (disposed) return
            if (!response.ok) {
              const failure = new Error('HTTP ' + response.status)
              failure.code = 'HTTP_' + response.status
              throw failure
            }
            const body = await response.json()
            if (disposed) return
            if (!body || body.ok !== true) {
              const error = body && body.error ? body.error : {}
              const failure = new Error(typeof error.message === 'string' && error.message ? error.message : 'Request failed')
              failure.code = typeof error.code === 'string' ? error.code : 'bot/error'
              throw failure
            }
            value = body.value && typeof body.value === 'object' ? body.value : {}
          } catch (error) {
            if (disposed) return
            if (error && error.name === 'AbortError') return
            failures += 1
            publish(bots.length > 0 ? 'stale' : 'error', {
              message: String((error && error.message) || error || 'unknown'),
              code: error && error.code ? error.code : 'NETWORK',
              at: Date.now(),
            })
            const wait = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]
            schedule(wait)
            return
          }

          failures = 0
          if (typeof value.revision === 'number') revision = value.revision
          if (typeof value.liveKey === 'string') liveKey = value.liveKey
          if (typeof value.modelsKey === 'string') modelsKey = value.modelsKey
          if (value.work && typeof value.work === 'object') work = value.work
          if (Array.isArray(value.bots)) bots = value.bots
          if (Array.isArray(value.sections)) sections = value.sections
          if (value.mainBotId !== undefined) mainBotId = value.mainBotId

          // A Bot that leaves the working set just finished a turn. Keep it for a
          // few seconds so the row says so instead of blinking back to idle.
          const now = Date.now()
          const workingNow = new Set()
          const runningWork = work && work.bots && typeof work.bots === 'object' ? work.bots : {}
          for (const id of Object.keys(runningWork)) workingNow.add(id)
          let changed = firstAnswer
          if (!firstAnswer) {
            for (const id of workingBefore) {
              if (workingNow.has(id)) continue
              justFinished[id] = now
              changed = true
            }
          }
          const nextFinished = {}
          for (const id of Object.keys(justFinished)) {
            if (now - justFinished[id] < JUST_FINISHED_MS * 3) nextFinished[id] = justFinished[id]
          }
          justFinished = nextFinished
          workingBefore = workingNow
          firstAnswer = false

          publish('ready', null)
          schedule(POLL_MS)
        }

        const onVisibility = () => {
          try {
            if (document.visibilityState === 'visible') schedule(0)
          } catch (error) {
            /* nothing to resume */
          }
        }

        try {
          if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('visibilitychange', onVisibility)
          }
        } catch (error) {
          /* no document: the loop still runs while the pane is open */
        }

        run()

        return () => {
          disposed = true
          stoppedRef.current = true
          if (timer !== null) clearTimeout(timer)
          try {
            if (controller) controller.abort()
          } catch (error) {
            /* already settled */
          }
          try {
            if (typeof document !== 'undefined' && document.removeEventListener) {
              document.removeEventListener('visibilitychange', onVisibility)
            }
          } catch (error) {
            /* nothing to detach */
          }
        }
      }, [active, ctx])

      return snapshot
    }

    // --------------------------------------------------------------------- UI

    const LIGHT_SHAPE = {
      needsYou: 'square',
      working: 'circle',
      waitingBot: 'ring',
      failed: 'diamond',
      justFinished: 'hollow',
      idle: 'dot',
    }

    const STATE_INK = {
      needsYou: 'var(--dsw-alias-state-warning-strong, #B4720A)',
      working: 'var(--dsw-alias-state-success-strong, #12805C)',
      waitingBot: 'var(--dsw-alias-state-info-strong, #1F62D0)',
      failed: 'var(--dsw-alias-state-error-strong, #C3352B)',
      justFinished: 'var(--dsw-alias-state-info-weak, #2AA79B)',
      idle: 'var(--dsw-alias-text-tertiary, #8B949E)',
    }

    function Light(props) {
      const verdict = props.verdict
      const shape = LIGHT_SHAPE[verdict.state] || 'dot'
      const ink = STATE_INK[verdict.state] || STATE_INK.idle
      return h(
        'span',
        { className: 'btt-light', 'aria-hidden': 'true' },
        h('span', { className: 'btt-light-shape btt-light-shape--' + shape, style: { borderColor: ink, backgroundColor: shape === 'hollow' || shape === 'ring' ? 'transparent' : ink } }),
        verdict.blocked && verdict.stale ? h('span', { className: 'btt-stale-mark', style: { color: STATE_INK.failed } }, '!') : null,
      )
    }

    function Row(props) {
      const bot = props.bot
      const verdict = props.verdict
      const d = props.d
      const now = props.now
      const text = stateText(bot, verdict, now, d)
      const title = nameOf(bot) + ' · ' + text
      const isMain = props.mainBotId !== null && props.mainBotId !== undefined && String(props.mainBotId) === String(bot.id)
      const disabled = !bot.sessionId
      return h(
        'button',
        {
          type: 'button',
          className: 'btt-row',
          title: title,
          'aria-label': title + (disabled ? ' · ' + d.noSession : ''),
          'data-state': verdict.state,
          disabled: disabled,
          onClick: () => {
            if (!openBot(props.ctx, bot)) props.onOpenFailed && props.onOpenFailed()
          },
        },
        h('span', { className: 'btt-led', style: { backgroundColor: colorOf(bot) }, 'aria-hidden': 'true' }),
        h(
          'span',
          { className: 'btt-who' },
          h(
            'span',
            { className: 'btt-who-top' },
            h('span', { className: 'btt-name' }, nameOf(bot)),
            isMain ? h('span', { className: 'btt-main' }, d.main) : null,
          ),
          bot.role ? h('span', { className: 'btt-role' }, String(bot.role)) : null,
        ),
        h('span', { className: 'btt-status' }, text),
        h(Light, { verdict }),
      )
    }

    function Group(props) {
      const group = props.group
      const d = props.d
      const [expanded, setExpanded] = useState(false)
      const folded = group.bots.length > COLLAPSE_AT && !expanded
      const shown = folded ? group.bots.slice(0, COLLAPSE_AT) : group.bots
      const rest = group.bots.length - shown.length
      return h(
        'div',
        { className: 'btt-group' },
        group.name ? h('div', { className: 'btt-group-title' }, group.name) : null,
        shown.map((entry) =>
          h(Row, {
            key: String(entry.bot.id),
            bot: entry.bot,
            verdict: entry.verdict,
            mainBotId: props.mainBotId,
            ctx: props.ctx,
            now: props.now,
            d,
            onOpenFailed: props.onOpenFailed,
          }),
        ),
        rest > 0
          ? h(
              'button',
              { type: 'button', className: 'btt-more', onClick: () => setExpanded(true) },
              d.showRest + rest + d.showRestTail,
            )
          : null,
        expanded && group.bots.length > COLLAPSE_AT
          ? h('button', { type: 'button', className: 'btt-more', onClick: () => setExpanded(false) }, d.collapse)
          : null,
      )
    }

    function Banner(props) {
      const d = props.d
      return h(
        'div',
        { className: 'btt-banner', role: 'status' },
        h('span', { className: 'btt-banner-text' }, props.text),
        props.onRetry ? h('button', { type: 'button', className: 'btt-banner-action', onClick: props.onRetry }, d.retry) : null,
      )
    }

    function TeamPanel(props) {
      const ctx = props.ctx
      const d = useMemo(() => DICT[pickLang(ctx)], [ctx])
      const active = props.visible !== false
      const snapshot = useRoster(ctx, active)
      const [now, setNow] = useState(Date.now())
      const [notice, setNotice] = useState('')
      const [retryToken, setRetryToken] = useState(0)

      // The clock the rows read: it only runs while something can change on its
      // own (a turn in flight, or a row that just finished counting down).
      const ticking = snapshot.phase === 'ready' && (snapshot.running > 0 || Object.keys(snapshot.justFinished || {}).length > 0)
      useEffect(() => {
        if (!active || !ticking) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [active, ticking])

      useEffect(() => {
        if (!notice) return undefined
        const timer = setTimeout(() => setNotice(''), 4000)
        return () => clearTimeout(timer)
      }, [notice])

      const groups = useMemo(() => {
        const rows = []
        const list = Array.isArray(snapshot.bots) ? snapshot.bots : []
        const view = { work: snapshot.work || EMPTY_WORK, justFinished: snapshot.justFinished || {} }
        for (const bot of list) {
          if (!bot || typeof bot !== 'object') continue
          if (bot.hidden === true) continue
          const verdict = classify(bot, view, now)
          rows.push({ bot, verdict })
        }
        const grouped = buildGroups(
          rows.map((entry) => entry.bot),
          snapshot.sections,
          d,
        )
        const byId = new Map(rows.map((entry) => [String(entry.bot.id), entry]))
        return grouped.map((group) => ({
          id: group.id,
          name: group.name,
          bots: group.bots
            .map((bot) => byId.get(String(bot.id)))
            .filter(Boolean)
            .sort((a, b) => {
              const order = STATE_ORDER.indexOf(a.verdict.state) - STATE_ORDER.indexOf(b.verdict.state)
              if (order !== 0) return order
              const left = typeof a.bot.lastAt === 'number' ? a.bot.lastAt : 0
              const right = typeof b.bot.lastAt === 'number' ? b.bot.lastAt : 0
              if (left !== right) return right - left
              return nameOf(a.bot).localeCompare(nameOf(b.bot))
            }),
        }))
      }, [snapshot.bots, snapshot.sections, snapshot.work, snapshot.justFinished, d, now])

      if (snapshot.phase === 'loading') {
        return h('div', { className: 'btt-root' }, h('div', { className: 'btt-empty' }, '…'))
      }
      if (snapshot.phase === 'error') {
        return h(
          'div',
          { className: 'btt-root' },
          h(Banner, {
            d,
            text: d.loadFailed + (snapshot.error && snapshot.error.message ? ' · ' + snapshot.error.message : ''),
            onRetry: () => {
              setRetryToken(retryToken + 1)
              setNotice('')
            },
          }),
        )
      }
      if (groups.length === 0) {
        return h('div', { className: 'btt-root' }, h('div', { className: 'btt-empty' }, d.empty))
      }

      return h(
        'div',
        { className: 'btt-root', 'data-phase': snapshot.phase, key: 'roster-' + retryToken },
        snapshot.phase === 'stale' ? h(Banner, { d, text: d.stale, onRetry: () => setRetryToken(retryToken + 1) }) : null,
        notice ? h(Banner, { d, text: notice }) : null,
        groups.map((group) =>
          h(Group, {
            key: group.id,
            group,
            d,
            now,
            ctx,
            mainBotId: snapshot.mainBotId,
            onOpenFailed: () => setNotice(d.noSession),
          }),
        ),
      )
    }

    // ------------------------------------------------------------------ styles

    const CSS = [
      '.btt-root{display:flex;flex-direction:column;gap:1px;padding:6px 4px 12px;font-size:13px;line-height:1.35;color:var(--dsw-alias-text-primary,#1F2328);overflow-y:auto;overflow-x:hidden;height:100%;box-sizing:border-box}',
      '.btt-group{display:flex;flex-direction:column;gap:1px;padding-bottom:2px}',
      '.btt-group-title{display:flex;align-items:center;gap:6px;padding:8px 8px 3px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-text-tertiary,#8B949E);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.btt-row{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:3px 8px;border:0;border-radius:8px;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer;box-sizing:border-box}',
      '.btt-row:hover{background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.12))}',
      '.btt-row:focus-visible{outline:2px solid var(--dsw-alias-state-info-strong,#1F62D0);outline-offset:-2px}',
      '.btt-row:disabled{cursor:default;opacity:.6}',
      '.btt-led{flex:0 0 auto;width:7px;height:7px;border-radius:50%}',
      '.btt-who{display:flex;flex-direction:column;justify-content:center;min-width:0;flex:0 1 auto;max-width:46%}',
      '.btt-who-top{display:flex;align-items:center;gap:4px;min-width:0}',
      '.btt-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.btt-main{flex:0 0 auto;font-size:9px;line-height:1;padding:2px 4px;border-radius:4px;color:var(--dsw-alias-text-secondary,#6A737D);background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.16))}',
      '.btt-role{font-size:10.5px;color:var(--dsw-alias-text-tertiary,#8B949E);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.btt-status{flex:1 1 0;min-width:0;font-size:11.5px;color:var(--dsw-alias-text-secondary,#57606A);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.btt-light{flex:0 0 auto;display:inline-flex;align-items:center;gap:2px;width:auto}',
      '.btt-light-shape{display:block;width:8px;height:8px;box-sizing:border-box;border:1.5px solid transparent}',
      '.btt-light-shape--circle{border-radius:50%}',
      '.btt-light-shape--dot{border-radius:50%;opacity:.55}',
      '.btt-light-shape--square{border-radius:1.5px}',
      '.btt-light-shape--diamond{border-radius:1px;transform:rotate(45deg) scale(.9)}',
      '.btt-light-shape--ring{border-radius:50%;border-width:2px}',
      '.btt-light-shape--hollow{border-radius:50%;border-width:2px;opacity:.8}',
      '.btt-stale-mark{font-size:10px;font-weight:700;line-height:1}',
      '.btt-more{align-self:flex-start;margin:2px 0 2px 23px;padding:2px 6px;border:0;border-radius:6px;background:transparent;font:inherit;font-size:11px;color:var(--dsw-alias-text-tertiary,#8B949E);cursor:pointer}',
      '.btt-more:hover{color:var(--dsw-alias-text-secondary,#57606A);background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.12))}',
      '.btt-empty{display:flex;align-items:center;justify-content:center;min-height:96px;padding:16px;text-align:center;font-size:12px;color:var(--dsw-alias-text-tertiary,#8B949E)}',
      '.btt-banner{display:flex;align-items:center;gap:8px;margin:2px 4px 6px;padding:6px 8px;border-radius:8px;font-size:11.5px;color:var(--dsw-alias-text-secondary,#57606A);background:var(--dsw-alias-fill-secondary,rgba(127,127,127,.12))}',
      '.btt-banner-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.btt-banner-action{flex:0 0 auto;border:0;border-radius:6px;padding:2px 6px;font:inherit;font-size:11px;cursor:pointer;color:var(--dsw-alias-text-primary,#1F2328);background:var(--dsw-alias-fill-tertiary,rgba(127,127,127,.2))}',
    ].join('')

    function installStyles() {
      try {
        if (typeof document === 'undefined' || !document.head) return () => {}
        if (document.getElementById(STYLE_ID)) return () => {}
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          try {
            if (style.parentNode) style.parentNode.removeChild(style)
          } catch (error) {
            /* the head is gone with the page */
          }
        }
      } catch (error) {
        return () => {}
      }
    }

    // ------------------------------------------------------------------- icons

    function TeamIcon(size) {
      const px = typeof size === 'number' && size > 0 ? size : 16
      return h(
        'svg',
        {
          width: px,
          height: px,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', { cx: 9, cy: 8, r: 3.2 }),
        h('path', { d: 'M3.2 19.2c.5-3 2.9-4.8 5.8-4.8s5.3 1.8 5.8 4.8' }),
        h('circle', { cx: 17, cy: 9, r: 2.4 }),
        h('path', { d: 'M15.6 14.6c2.6-.2 4.8 1.4 5.2 4.1' }),
      )
    }

    // ------------------------------------------------------------------- apply

    function describe(ctx) {
      const d = DICT[pickLang(ctx)]
      return {
        id: TAB_ID,
        title: () => DICT[pickLang(ctx)].title,
        description: d.description,
        order: 60,
        single: true,
        icon: TeamIcon,
        component: (props) => h(TeamPanel, { ctx, ...props }),
      }
    }

    return {
      /**
       * `betterSidebar` is the one service this plugin cannot live without: it is
       * what a tab is registered on. Declaring it here means the browser half is
       * applied only once that service exists, and never spins on its own.
       */
      /**
       * The pure parts, exposed for the offline self-test (scripts/selftest.mjs).
       * Nothing in a running page reads this; it is not an API.
       */
      __internals: {
        classify,
        stateText,
        buildGroups,
        colorOf,
        elapsedText,
        agoText,
        stageOf,
        sectionIdOf,
        chatSessions,
        DICT,
        STATE_ORDER,
        JUST_FINISHED_MS,
        STALE_FAIL_MS,
        TAB_ID,
        POLL_MS,
        BACKOFF_MS,
      },
      inject: ['betterSidebar'],

      apply(ctx) {
        let service = null
        try {
          service = ctx.betterSidebar
        } catch (error) {
          service = null
        }
        if (!service && typeof ctx.get === 'function') {
          try {
            service = ctx.get('betterSidebar')
          } catch (error) {
            service = null
          }
        }
        if (!service || typeof service.registerTab !== 'function') {
          console.warn('[dsh-bot-team-tab] better-sidebar is not available; no Team tab registered')
          return
        }

        ctx.effect(() => installStyles(), 'dsh-bot-team-tab: styles')

        ctx.effect(() => {
          let dispose = null
          try {
            dispose = service.registerTab(describe(ctx))
          } catch (error) {
            const message = String((error && error.message) || error || '')
            // Hot reload hands the same tab to a second activation before the
            // first one is disposed: an id already registered is not a failure.
            if (message.indexOf('already registered') === -1) {
              console.error('[dsh-bot-team-tab] registerTab failed', error)
            }
            return () => {}
          }
          return () => {
            try {
              if (typeof dispose === 'function') dispose()
            } catch (error) {
              console.error('[dsh-bot-team-tab] dispose failed', error)
            }
          }
        }, 'dsh-bot-team-tab: tab')

        // The title is a function of the language, and the language can change
        // under a running page: re-registering is not possible, so keep a
        // subscription that only asks the sidebar to repaint its strip.
        try {
          const locale = typeof ctx.get === 'function' ? ctx.get('locale') : null
          if (locale && typeof locale.subscribe === 'function') {
            ctx.effect(() => locale.subscribe(() => {}), 'dsh-bot-team-tab: locale')
          }
        } catch (error) {
          /* a host without the locale service is fine */
        }
      },
    }
  },
})
