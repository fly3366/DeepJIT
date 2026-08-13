import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeepJitStore } from '../src/store.ts'

test('store: schema v1, batch insert, watermark', () => {
  const store = new DeepJitStore(':memory:')
  store.upsertSession('s1', 1000)
  store.insertTraces([
    { session_id: 's1', turn: 1, step: 0, kind: 'user', seq: 10, ts_ms: 1000, payload: '{"text":"hi"}' },
    { session_id: 's1', turn: 1, step: 1, kind: 'tool', seq: 20, ts_ms: 1100, payload: '{"name":"a"}' },
    { session_id: 's1', turn: 1, step: 2, kind: 'boundary', seq: 30, ts_ms: 1200, payload: '{"boundary":"turn/end"}' },
  ])
  assert.equal(store.stats().traces, 3)
  assert.deepEqual({ ...store.getSessionWatermark('s1') }, { last_seq: 30, last_summarized_seq: 0 })
  const rows = store.readTracesSince('s1', 0, ['tool'])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.seq, 20)
  store.advanceSummarizeWatermark('s1', 30)
  assert.equal(store.getSessionWatermark('s1').last_summarized_seq, 30)
  assert.equal(store.listSummarizableSessions().length, 0)
  store.close()
})

test('store: duplicate seq is ignored', () => {
  const store = new DeepJitStore(':memory:')
  store.upsertSession('s1', 1)
  store.insertTraces([{ session_id: 's1', turn: 1, step: 0, kind: 'user', seq: 5, ts_ms: 1, payload: '{"text":"a"}' }])
  store.insertTraces([{ session_id: 's1', turn: 1, step: 0, kind: 'user', seq: 5, ts_ms: 1, payload: '{"text":"b"}' }])
  assert.equal(store.stats().traces, 1)
  store.close()
})

test('store: pattern accumulation across runs and sessions', () => {
  const store = new DeepJitStore(':memory:')
  store.upsertPattern('flow-seq', 'a>b>c', 2, 1, 's1', 1000)
  store.upsertPattern('flow-seq', 'a>b>c', 3, 1, 's2', 2000)
  const hot = store.getHotPatterns('flow-seq', 3, 2, 10)
  assert.equal(hot.length, 1)
  assert.equal(hot[0]!.count, 5)
  assert.equal(hot[0]!.sessions_seen, 2)
  store.markPatternCompiled(hot[0]!.id)
  assert.equal(store.getHotPatterns('flow-seq', 3, 2, 10).length, 0)
  store.close()
})

test('store: artifacts lifecycle', () => {
  const store = new DeepJitStore(':memory:')
  store.insertArtifact({ type: 'flow', name: 'deepjit-x', description: 'x', file_path: '/tmp/x.json', status: 'active' })
  assert.ok(store.hasArtifact('deepjit-x'))
  store.updateArtifactStatus('deepjit-x', 'disabled')
  assert.equal(store.getArtifact('deepjit-x')!.status, 'disabled')
  store.deleteArtifact('deepjit-x')
  assert.ok(!store.hasArtifact('deepjit-x'))
  store.close()
})
