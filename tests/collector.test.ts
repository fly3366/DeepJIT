import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeepJitStore } from '../src/store.js'
import { TraceCollector } from '../src/collector.js'

function makeCollector(store: DeepJitStore) {
  const collector = new TraceCollector(store, () => collector.flushSync(), 1000, 200)
  return collector
}

test('collector: user/assistant/tool traces with raw value attach', () => {
  const store = new DeepJitStore(':memory:')
  const c = makeCollector(store)

  c.handleEvent('s1', { type: 'user/message', seq: 1, time: 1000, data: { content: [{ type: 'text', text: 'hello world' }] } })
  c.handleEvent('s1', { type: 'tool/call', seq: 2, time: 1010, data: { callId: 'c1', name: 'read_file', arguments: '{"path":"/a.txt"}', turn: 1, step: 0 } })
  // tools/result fires first here: raw value lands in the pending map
  c.handleToolResult({ callId: 'c1' }, { isError: false, value: { lines: 3 }, content: [{ type: 'text', text: 'file body' }] })
  c.handleEvent('s1', { type: 'tool/result', seq: 3, time: 1210, data: { callId: 'c1', turn: 1, step: 0, message: { content: [{ type: 'text', text: 'file body' }] } } })
  c.handleEvent('s1', { type: 'assistant/message', seq: 4, time: 1300, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'done' }] }, usage: { totalTokens: 10 } } })
  c.handleEvent('s1', { type: 'turn/end', seq: 5, time: 1400, data: { turn: 1, reason: 'completed' } })
  c.flushSync()

  const rows = store.readTracesSince('s1', 0, ['user', 'assistant', 'tool', 'boundary'])
  assert.equal(rows.length, 4)
  const tool = rows.find((r) => r.kind === 'tool')!
  const payload = JSON.parse(tool.payload)
  assert.equal(payload.name, 'read_file')
  assert.equal(payload.tool_ms, 200)
  assert.equal(payload.result_ok, true)
  assert.equal(payload.raw_value, '{"lines":3}')
  const boundary = rows.find((r) => r.kind === 'boundary')!
  assert.equal(JSON.parse(boundary.payload).reason, 'completed')
  const assistant = rows.find((r) => r.kind === 'assistant')!
  assert.equal(JSON.parse(assistant.payload).usage.totalTokens, 10)
  assert.equal(store.getSessionWatermark('s1').last_seq, 5)
  store.close()
})

test('collector: result event first, then tools/result patches buffered row', () => {
  const store = new DeepJitStore(':memory:')
  const c = makeCollector(store)
  c.handleEvent('s1', { type: 'tool/call', seq: 1, time: 1, data: { callId: 'c2', name: 'b', arguments: '{}', turn: 1, step: 0 } })
  c.handleEvent('s1', { type: 'tool/result', seq: 2, time: 100, data: { callId: 'c2', turn: 1, step: 0, message: { content: [{ type: 'text', text: 'ok' }] } } })
  c.handleToolResult({ callId: 'c2' }, { isError: false, value: { n: 42 } })
  c.flushSync()
  const rows = store.readTracesSince('s1', 0, ['tool'])
  assert.equal(rows.length, 1)
  const payload = JSON.parse(rows[0]!.payload)
  assert.equal(payload.raw_value, '{"n":42}')
  store.close()
})

test('collector: truncated values and failed tool calls', () => {
  const store = new DeepJitStore(':memory:')
  const c = new TraceCollector(store, () => c.flushSync(), 20, 200)
  c.handleEvent('s1', { type: 'tool/call', seq: 1, time: 1, data: { callId: 'c3', name: 'x', arguments: JSON.stringify({ big: 'a'.repeat(100) }), turn: 1, step: 0 } })
  c.handleEvent('s1', { type: 'tool/result', seq: 2, time: 2, data: { callId: 'c3', turn: 1, step: 0, error: { name: 'E', code: '1' }, message: { content: [{ type: 'text', text: 'boom' }] } } })
  c.flushSync()
  const payload = JSON.parse(store.readTracesSince('s1', 0, ['tool'])[0]!.payload)
  assert.equal(payload.result_ok, false)
  assert.ok(payload.args.includes('truncated'))
  store.close()
})
