import type { EngineInterface, Register, TurnUsage } from 'claude-code'

type Meter = {
  context: number
  window: number
  input: number
  cached: number
  output: number
  usd: number | null
  isWorking: boolean
  isCompactPending: boolean
  isCompacting: boolean
  // False on Claude Code builds without $.session.compact / $.session.usage.
  canCompact: boolean
  canMeasure: boolean
  retries: number
  compactions: number
}

// Compact once the live context reaches this many tokens.
const COMPACT_AT = 150_000
// How long to wait before retrying a compaction the engine refused (a turn was running).
const RETRY_MS = 2_000
const MAX_RETRIES = 60

const m: Meter = {
  context: 0, window: 0, input: 0, cached: 0, output: 0, usd: null,
  isWorking: false, isCompactPending: false, isCompacting: false,
  canCompact: true, canMeasure: true, retries: 0, compactions: 0,
}

function fmt(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : `${n}`
}

function contextOf(u: TurnUsage) {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
}

function isMissing(x: unknown) {
  return x instanceof TypeError && /not a function|undefined/.test(x.message)
}

// The fill colour follows Claude's own theme: calm, then amber, then red as compaction nears.
function tone(ratio: number) {
  return ratio >= 0.9 ? 'error' : ratio >= 0.7 ? 'warning' : 'claude'
}

function set($: EngineInterface, patch: Partial<Meter>) {
  Object.assign(m, patch)
  $.ui.invalidate('ui.render')
}

async function refresh($: EngineInterface) {
  if (!m.canMeasure) return
  try {
    const u = await $.session.usage()
    set($, {
      context: u.context.tokens ?? m.context,
      window: u.context.window || m.window,
      usd: u.cost?.usd ?? m.usd,
    })
  } catch (x) {
    if (isMissing(x)) set($, { canMeasure: false })
  }
}

async function tryCompact($: EngineInterface) {
  if (!m.isCompactPending || m.isCompacting || !m.canCompact) return
  if (m.isWorking) {
    $.clock.after(RETRY_MS, () => tryCompact($))
    return
  }
  set($, { isCompacting: true })
  const before = m.context
  try {
    const r = await $.session.compact()
    if ('skip' in r && r.skip) {
      $.ui.toast(`✻ Auto-compact skipped: ${r.skip}`)
      set($, { isCompactPending: false, retries: 0 })
    } else {
      $.ui.toast(`✻ Context compacted at ${fmt(before)} tokens`)
      set($, { isCompactPending: false, retries: 0, context: 0, compactions: m.compactions + 1 })
    }
    await refresh($)
  } catch (x) {
    if (isMissing(x)) {
      set($, { canCompact: false, isCompactPending: false })
      $.ui.toast('✻ Auto-compact needs a newer Claude Code: run `claude update`')
    } else if (m.retries < MAX_RETRIES) {
      // Rejected while a turn runs: try again once it has ended.
      set($, { retries: m.retries + 1 })
      $.clock.after(RETRY_MS, () => tryCompact($))
    } else {
      set($, { isCompactPending: false, retries: 0 })
    }
  } finally {
    set($, { isCompacting: false })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('turn.start', async ($, e, next) => {
    set($, { isWorking: true })
    return next(e)
  })

  // Every model request, mid-turn: live figures as the turn goes.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r.usage
    if (u) {
      const context = e.agentId ? m.context : contextOf(u)
      set($, {
        input: m.input + u.input_tokens + u.cache_creation_input_tokens,
        cached: m.cached + u.cache_read_input_tokens,
        output: m.output + u.output_tokens,
        context,
        isCompactPending: m.canCompact && (m.isCompactPending || context >= COMPACT_AT),
      })
    }
    return r
  })

  // Compact only between turns: a running answer is never cut short.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    set($, { isWorking: false })
    await refresh($)
    if (m.canCompact && (m.context >= COMPACT_AT || m.isCompactPending)) {
      set($, { isCompactPending: true })
      $.clock.after(500, () => tryCompact($))
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    const ratio = Math.min(1, m.context / COMPACT_AT)
    const isDesktop = e.surface !== 'terminal'
    const cols = e.props.bodyColumns
    // Proportional fonts on the desktop draw blocks wide: keep the bar short there.
    const barWidth = isDesktop ? 12 : cols >= 100 ? 24 : cols >= 70 ? 16 : 10
    const filled = Math.max(m.context > 0 ? 1 : 0, Math.round(ratio * barWidth))
    const color = tone(ratio)
    const pct = Math.round(ratio * 100)

    const details = [
      `↑ ${fmt(m.input)}`,
      `↓ ${fmt(m.output)}`,
      `⟲ ${fmt(m.cached)}`,
      ...(m.window ? [`window ${fmt(m.window)}`] : []),
      ...(m.usd !== null ? [`$${m.usd.toFixed(2)}`] : []),
      ...(m.compactions ? [`compacted ×${m.compactions}`] : []),
    ].join('  ·  ')

    const status = m.isCompacting
      ? 'Compacting conversation…'
      : m.isCompactPending
        ? 'Auto-compact queued · runs when this turn ends'
        : !m.canCompact
          ? 'Auto-compact off · run `claude update`'
          : null

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" flexWrap="nowrap">
          <Box flexShrink={0}>
            <Text color="claude">✻ </Text>
            <Text bold>Context </Text>
          </Box>
          <Box flexShrink={0}>
            <Text color={color}>{'█'.repeat(filled)}</Text>
            <Text color="inactive" dimColor>{'█'.repeat(barWidth - filled)}</Text>
          </Box>
          <Box flexShrink={0}>
            <Text bold color={color}>{` ${fmt(m.context)}`}</Text>
            <Text color="subtle">{` / ${fmt(COMPACT_AT)} · ${pct}%`}</Text>
          </Box>
        </Box>
        <Box flexDirection="row" flexWrap="nowrap" paddingLeft={2}>
          <Text color="subtle" wrap="truncate-end">
            {status ? '' : '⎿ '}
            {status ? '' : details}
          </Text>
          {status && (
            <Text color={m.isCompacting ? 'claude' : 'warning'} wrap="truncate-end">{`⎿ ${status}`}</Text>
          )}
        </Box>
      </Box>
    )
  })
}
