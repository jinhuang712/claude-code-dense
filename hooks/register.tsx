import { update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { FoldRow } from '../types'

const rowRef = { plugin: 'dense', key: 'row' } as const
const expandedRef = { plugin: 'dense', key: 'expanded' } as const

type Call = { id: string; tool: string; hasFailed: boolean }
// responseRows: every main-loop response row of the turn (thinking, text,
// tool_use); the engine may draw any of them as an AssistantMessage (a
// summary of in-between text came under a thinking row's id).
type Turn = { id: string; calls: Call[]; textRows: string[]; responseRows: string[] }

// The transcript may draw a row under a provisional id: the real one with
// everything past its 24th character zeroed (`bb1a1d64-d62b-42ca-b488-000…`,
// `toolu_01J4ByJtnPPxSuzrT4000…`). Fold state is keyed by the shared head.
function rowKey(id: string): string {
  return id.slice(0, 24)
}

// How long a toggle waits for the unfolded rows to be laid out before it
// scrolls; the state write redraws its readers at the redraw rate.
const REDRAW_MS = 60

// The turn being tracked; a reload mid-turn only loses that one turn's fold.
let current: Turn | null = null

const PLURAL: Record<string, [string, string]> = {
  bash: ['bash', 'bash'],
  edit: ['edit', 'edits'],
  read: ['read', 'reads'],
  search: ['search', 'searches'],
  agent: ['agent', 'agents'],
  web: ['web', 'web'],
}

function category(tool: string): string {
  if (tool === 'Bash' || tool === 'PowerShell') return 'bash'
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(tool)) return 'edit'
  if (tool === 'Read') return 'read'
  if (['Grep', 'Glob', 'LS'].includes(tool)) return 'search'
  if (tool === 'Agent' || tool === 'Task') return 'agent'
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web'
  if (tool.startsWith('mcp__')) {
    const server = (tool.split('__')[1] ?? 'mcp').replace(/^claude_ai_/, '')
    return `mcp(${server})`
  }
  return tool
}

function summarize(turn: Turn, countNotes: boolean): string {
  const counts = new Map<string, number>()
  for (const call of turn.calls) {
    const kind = category(call.tool)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const parts = [...counts].map(([kind, n]) => {
    const names = PLURAL[kind]
    return `${n} ${names ? names[n === 1 ? 0 : 1] : kind}`
  })
  const notes = turn.textRows.length - 1
  if (countNotes && notes > 0) parts.push(`${notes} ${notes === 1 ? 'note' : 'notes'}`)
  return parts.join(' · ')
}

async function drawFolded(
  $: EngineInterface,
  e: RenderInput,
  row: FoldRow,
  drawOwn: () => Promise<RenderElement>,
): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e)
  const turnExpanded = { ...expandedRef, id: row.turnId }
  const { value: isOpen = false } = await $.state.get(turnExpanded)
  if (row.role === 'hidden') return isOpen ? drawOwn() : <Box />
  const toggle = async () => {
    await update($, turnExpanded, open => !open)
    // At the bottom the transcript sticks to its end, so rows unfolding below
    // this line push it up and away. Once they are laid out, bring this line
    // back to the top; no API holds a row at its old screen position.
    await $.clock.sleep(REDRAW_MS)
    try {
      await $.ui.scroll({ to: { requestId: e.requestId }, block: 'start' })
    } catch (err) {
      $.ui.log(`dense: scroll after toggle failed: ${String(err)}`, { to: 'debug' })
    }
  }
  // marginTop matches the gap the engine's own rows keep above themselves.
  const header = (
    <Box flexDirection="row" marginTop={1}>
      <Text dimColor>
        {'● '}
        {row.text}
      </Text>
      {row.failed > 0 && <Text color="red">{` · ${row.failed} failed`}</Text>}
      <Text> </Text>
      {/* A Button paints in accent, plain or dim only; a Box behind it gives
          the two states contrasting theme colors. */}
      <Box backgroundColor={isOpen ? 'diffRemoved' : 'diffAdded'}>
        <Button
          key={`fold-${row.turnId}`}
          label={isOpen ? ' ▾ fold ' : ' ▸ expand '}
          plain
          onPress={toggle}
        />
      </Box>
    </Box>
  )
  if (!isOpen) return header
  return (
    <Box flexDirection="column">
      {header}
      {await drawOwn()}
    </Box>
  )
}

export const register: Register = (on, options) => {
  const foldFailedTurns = options.foldFailedTurns !== false
  const hideNotes = options.hideNotes !== false

  on('turn.start', async ($, e, next) => {
    current = { id: e.turnId, calls: [], textRows: [], responseRows: [] }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const turn = current
    if (e.agentId !== undefined || turn === null) return next(e)
    const call: Call = { id: e.tool_use_id, tool: e.tool, hasFailed: false }
    turn.calls.push(call)
    const ran = await next(e)
    call.hasFailed = ran.deny !== undefined || ran.isError === true
    return ran
  }).catch(($, e, next) => next(e))

  on('session.append', async ($, e, next) => {
    const turn = current
    if (e.agentId === undefined && e.door === 'response' && turn !== null) {
      const content = e.message.content
      const kinds = Array.isArray(content) ? content.map(block => block.type) : ['text']
      turn.responseRows.push(e.uuid)
      if (kinds.includes('text')) turn.textRows.push(e.uuid)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const turn = current
    if (e.agentId !== undefined || turn === null || turn.id !== e.turnId) {
      return next(e)
    }
    current = null
    const failed = turn.calls.filter(call => call.hasFailed).length
    const shouldFold =
      turn.calls.length > 0 && e.reason === 'answer' && (foldFailedTurns || failed === 0)
    if (shouldFold) {
      const text = summarize(turn, hideNotes)
      const [first, ...rest] = turn.calls
      const answerRow = turn.textRows.at(-1)
      const hiddenIds = [
        ...rest.map(call => call.id),
        ...(hideNotes ? turn.responseRows.filter(id => id !== answerRow) : []),
      ]
      await Promise.all([
        first &&
          $.state.set(
            { ...rowRef, id: rowKey(first.id) },
            { role: 'summary', turnId: turn.id, text, failed },
          ),
        ...hiddenIds.map(id =>
          $.state.set({ ...rowRef, id: rowKey(id) }, { role: 'hidden', turnId: turn.id }),
        ),
      ])
      $.ui.log(`dense: folded ${turn.id}: ${text}`, { to: 'debug' })
    }
    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { value: row = null } = await $.state.get({ ...rowRef, id: rowKey(e.requestId) })
    if (row === null) return next(e)
    return drawFolded($, e, row, () => next(e))
  })

  // A standalone call's result (`⎿ Added 9 lines`) is a row of its own, the
  // tool_result's user message, so hiding the call's row leaves it drawn. It
  // folds with its call, the summary row's included.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { value: row = null } = await $.state.get({ ...rowRef, id: rowKey(e.requestId) })
    if (row === null) return next(e)
    return drawFolded($, e, { role: 'hidden', turnId: row.turnId }, () => next(e))
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const ids = e.props.calls.flatMap(call => (call.tool_use_id === undefined ? [] : [call.tool_use_id]))
    const reads = await Promise.all(ids.map(id => $.state.get({ ...rowRef, id: rowKey(id) })))
    const rows = reads.flatMap(({ value }) => (value == null ? [] : [value]))
    // A call the engine refused before it ran (an unknown tool) never reaches
    // tool.call, so one known call is enough to fold the group with its turn.
    const row = rows.find(r => r.role === 'summary') ?? rows[0]
    if (row === undefined) return next(e)
    return drawFolded($, e, row, () => next(e))
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const { value: row = null } = await $.state.get({ ...rowRef, id: rowKey(e.requestId) })
    if (row === null) return next(e)
    return drawFolded($, e, row, () => next(e))
  })
}
