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
  compactions: number
}

// Compact once the live context reaches this many tokens.
const COMPACT_AT = 150_000
// How long to wait before retrying a compaction the engine refused (a turn was running).
const RETRY_MS = 2_000

const m: Meter = {
  context: 0, window: 0, input: 0, cached: 0, output: 0, usd: null,
  isWorking: false, isCompactPending: false, isCompacting: false, compactions: 0,
}

function fmt(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`
}

function contextOf(u: TurnUsage) {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
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
  const u = await $.session.usage()
  set($, {
    context: u.context.tokens ?? m.context,
    window: u.context.window || m.window,
    usd: u.cost?.usd ?? null,
  })
}

async function tryCompact($: EngineInterface) {
  if (!m.isCompactPending || m.isCompacting) return
  if (m.isWorking) {
    $.clock.after(RETRY_MS, () => tryCompact($))
    return
  }
  set($, { isCompacting: true })
  const before = m.context
  try {
    const r = await $.session.compact()
    if ('skip' in r && r.skip) {
      set($, { isCompactPending: false })
      $.ui.toast(`✻ Auto-compact skipped: ${r.skip}`)
    } else {
      set($, { isCompactPending: false, context: 0, compactions: m.compactions + 1 })
      $.ui.toast(`✻ Context compacted at ${fmt(before)} tokens`)
    }
    await refresh($)
  } catch {
    // Rejected while a turn runs: try again once it has ended.
    $.clock.after(RETRY_MS, () => tryCompact($))
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
        isCompactPending: m.isCompactPending || context >= COMPACT_AT,
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
    if (m.context >= COMPACT_AT || m.isCompactPending) {
      set($, { isCompactPending: true })
      $.clock.after(500, () => tryCompact($))
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    const ratio = Math.min(1, m.context / COMPACT_AT)
    const cols = e.props.bodyColumns
    const isWide = cols >= 90
    const barWidth = isWide ? 20 : Math.max(8, Math.min(16, cols - 40))
    const filled = Math.round(ratio * barWidth)
    const color = tone(ratio)
    const pctOfWindow = m.window ? Math.round((m.context / m.window) * 100) : null

    const status = m.isCompacting
      ? { glyph: '✻', text: 'Compacting conversation…', color: 'claude' }
      : m.isCompactPending
        ? { glyph: '⎿', text: 'Auto-compact queued · runs when this turn ends', color: 'warning' }
        : null

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text color="claude">✻</Text>
          <Text bold>Context</Text>
          <Text>
            <Text color={color}>{'━'.repeat(filled)}</Text>
            <Text color="inactive">{'─'.repeat(barWidth - filled)}</Text>
          </Text>
          <Text>
            <Text bold color={color}>{fmt(m.context)}</Text>
            <Text color="inactive"> / {fmt(COMPACT_AT)}</Text>
            {pctOfWindow !== null && <Text color="subtle"> · {pctOfWindow}% of {fmt(m.window)}</Text>}
          </Text>
          {isWide && (
            <Text color="subtle" wrap="truncate-end">
              {'  '}↑ {fmt(m.input)}  ↓ {fmt(m.output)}  ⟲ {fmt(m.cached)} cached
              {m.usd !== null ? `  ·  $${m.usd.toFixed(2)}` : ''}
              {m.compactions ? `  ·  compacted ×${m.compactions}` : ''}
            </Text>
          )}
        </Box>
        {status && (
          <Box flexDirection="row" gap={1} paddingLeft={2}>
            <Text color={status.color}>{status.glyph}</Text>
            <Text color={status.color} italic={!m.isCompacting}>{status.text}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
