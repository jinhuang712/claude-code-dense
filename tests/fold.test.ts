import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const

// Stands in for the engine. `fails` lists tool_use_ids whose call errors.
function engineBeneath(on: On, fails: readonly string[] = []) {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', (_$, e) =>
    (fails.includes(e.tool_use_id)
      ? { isError: true, result: 'boom', text: 'boom' }
      : { result: { stdout: '', stderr: '', interrupted: false } }) as never,
  )
  on('ui.render', () => h('Text', null, 'engine row') as never)
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
}

function toolUseProps(tool: string, tool_use_id: string) {
  return { tool_use_id, tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false }
}

function complete(turnId: string, reason: 'answer' | 'aborted' = 'answer') {
  return { turnId, reason, answer: 'done', durationMs: 4200, isAborted: reason === 'aborted' } as never
}

test('folds a finished turn into one summary line, the rest drawn empty', async ($, on) => {
  engineBeneath(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'x', old_string: 'a', new_string: 'b', tool_use_id: 'b' } as never)
  await $.tool.call({ tool: 'mcp__claude_ai_lark__send', tool_use_id: 'c' } as never)
  await $.turn.complete(complete('t1'))

  await Promise.all(
    SURFACES.map(async surface => {
      const first = await $.ui.mount({
        plugin: 'dense',
        surface,
        component: 'ToolUse',
        requestId: 'a',
        props: toolUseProps('Bash', 'a'),
      })
      expect(await first.find({ text: /1 bash · 1 edit · 1 mcp\(lark\)/ })).toBeDefined()
      expect(await first.find({ text: /\ds/ })).toBeUndefined()
      expect(await first.find({ type: 'Button', key: 'fold-t1' })).toBeDefined()
      expect(await first.find({ text: /engine row/ })).toBeUndefined()

      const rest = await $.ui.mount({
        plugin: 'dense',
        surface,
        component: 'ToolUse',
        requestId: 'b',
        props: toolUseProps('Edit', 'b'),
      })
      expect(await rest.find({ text: /engine row/ })).toBeUndefined()
    }),
  )
})

test('expand shows the engine rows again', async ($, on) => {
  engineBeneath(on)
  await $.turn.start({ text: 'go', turnId: 't2' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await $.turn.complete(complete('t2'))

  const row = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'a',
    props: toolUseProps('Bash', 'a'),
  })
  expect((await row.find({ key: 'fold-t2' }))?.text).toMatch(/expand/)
  await row.press({ key: 'fold-t2' })
  expect(await row.find({ text: /engine row/ })).toBeDefined()
  expect((await row.find({ key: 'fold-t2' }))?.text).toMatch(/fold/)

  await row.press({ key: 'fold-t2' })
  expect(await row.find({ text: /engine row/ })).toBeUndefined()
})

test("a call's result row folds with its call and shows on expand", async ($, on) => {
  engineBeneath(on)
  await $.turn.start({ text: 'go', turnId: 't9' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await $.tool.call({ tool: 'Write', file_path: 'x', content: 'b', tool_use_id: 'b' } as never)
  await $.turn.complete(complete('t9'))

  const result = (tool: string, tool_use_id: string) =>
    $.ui.mount({
      plugin: 'dense',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: tool_use_id,
      props: { tool_use_id, tool, output: {}, isErrored: false },
    })
  const summaryResult = await result('Bash', 'a')
  const hiddenResult = await result('Write', 'b')
  expect(await summaryResult.find({ text: /engine row/ })).toBeUndefined()
  expect(await hiddenResult.find({ text: /engine row/ })).toBeUndefined()

  const row = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'a',
    props: toolUseProps('Bash', 'a'),
  })
  await row.press({ key: 'fold-t9' })
  expect(await summaryResult.find({ text: /engine row/ })).toBeDefined()
  expect(await hiddenResult.find({ text: /engine row/ })).toBeDefined()
})

test('a result row outside a folded turn draws as the engine does', async ($, on) => {
  engineBeneath(on)
  const result = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'z',
    props: { tool_use_id: 'z', tool: 'Bash', output: {}, isErrored: false },
  })
  expect(await result.find({ text: /engine row/ })).toBeDefined()
})

test('a group folds even when one of its calls never reached tool.call', async ($, on) => {
  engineBeneath(on)
  await $.turn.start({ text: 'go', turnId: 't4' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await $.tool.call({ tool: 'Read', file_path: 'x', tool_use_id: 'b' } as never)
  await $.turn.complete(complete('t4'))

  const call = (tool: string, tool_use_id: string) => ({
    tool,
    tool_use_id,
    input: {},
    isRunning: false,
    isErrored: true,
    isInterrupted: false,
  })
  const group = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'ToolGroup',
    requestId: 'collapsed-x',
    props: { calls: [call('Read', 'b'), call('Grep', 'never-seen')], isActive: false, isExpanded: false },
  })
  expect(await group.find({ text: /engine row/ })).toBeUndefined()
})

// The kit has no store beneath session.append, so the append itself rejects;
// the plugin records the row before its next(e), which is all these tests need.
function say($: Engine, uuid: string, text: string) {
  return $.session
    .append({
      door: 'response',
      uuid,
      origin: { kind: 'model', model: 'test' },
      message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    } as never)
    .catch(() => undefined)
}

test('in-between text hides under its provisional zero-tailed id, the answer stays', async ($, on) => {
  engineBeneath(on)
  await $.turn.start({ text: 'go', turnId: 't5' })
  await say($, 'bb1a1d64-d62b-42ca-b488-b74a9f6bf6fe', 'Running the test turn')
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await say($, '88677564-d231-4e71-a9bb-1a4757da561b', 'Test turn done')
  await $.turn.complete(complete('t5'))

  const message = (requestId: string, text: string) =>
    $.ui.mount({
      plugin: 'dense',
      surface: 'terminal',
      component: 'AssistantMessage',
      requestId,
      props: { text, isFirstOfReply: true },
    })
  const note = await message('bb1a1d64-d62b-42ca-b488-000000000000', 'Running the test turn')
  expect(await note.find({ text: /engine row/ })).toBeUndefined()
  const answer = await message('88677564-d231-4e71-a9bb-000000000000', 'Test turn done')
  expect(await answer.find({ text: /engine row/ })).toBeDefined()
})

test('with hideNotes off, in-between text stays and only tool calls fold', { options: { hideNotes: false } }, async ($, on) => {
  engineBeneath(on)
  await $.turn.start({ text: 'go', turnId: 't6' })
  await say($, 'bb1a1d64-d62b-42ca-b488-b74a9f6bf6fe', 'Running the test turn')
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await say($, '88677564-d231-4e71-a9bb-1a4757da561b', 'Test turn done')
  await $.turn.complete(complete('t6'))

  const note = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'bb1a1d64-d62b-42ca-b488-000000000000',
    props: { text: 'Running the test turn', isFirstOfReply: true },
  })
  expect(await note.find({ text: /engine row/ })).toBeDefined()
  const tool = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'a',
    props: toolUseProps('Bash', 'a'),
  })
  expect(await tool.find({ text: /1 bash/ })).toBeDefined()
  expect(await tool.find({ text: /note/ })).toBeUndefined()
})

test('a turn with a failed call folds, its summary counting the failure', async ($, on) => {
  engineBeneath(on, ['b'])
  await $.turn.start({ text: 'go', turnId: 't7' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: 'b' } as never)
  await $.turn.complete(complete('t7'))

  const row = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'a',
    props: toolUseProps('Bash', 'a'),
  })
  expect(await row.find({ text: /2 bash/ })).toBeDefined()
  expect(await row.find({ text: /1 failed/ })).toBeDefined()
})

test('with foldFailedTurns off, a turn with a failed call stays expanded', { options: { foldFailedTurns: false } }, async ($, on) => {
  engineBeneath(on, ['b'])
  await $.turn.start({ text: 'go', turnId: 't8' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await $.tool.call({ tool: 'Bash', command: 'false', tool_use_id: 'b' } as never)
  await $.turn.complete(complete('t8'))

  const row = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'a',
    props: toolUseProps('Bash', 'a'),
  })
  expect(await row.find({ text: /engine row/ })).toBeDefined()
})

test('an interrupted turn is left unfolded', async ($, on) => {
  engineBeneath(on)
  await $.turn.start({ text: 'go', turnId: 't3' })
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'a' } as never)
  await $.turn.complete(complete('t3', 'aborted'))

  const row = await $.ui.mount({
    plugin: 'dense',
    surface: 'terminal',
    component: 'ToolUse',
    requestId: 'a',
    props: toolUseProps('Bash', 'a'),
  })
  expect(await row.find({ text: /engine row/ })).toBeDefined()
})
