import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeepJitStore, qualityScore } from '../src/store.ts'

test('store: qualityScore combines success rate and damped usage volume', () => {
  assert.equal(qualityScore(0, 0), 0)
  assert.equal(qualityScore(10, 10), Math.round(Math.log2(11) * 100) / 100) // rate 1
  assert.equal(qualityScore(10, 5), Math.round(0.5 * Math.log2(11) * 100) / 100) // rate 0.5
  assert.ok(qualityScore(1000, 1000) > qualityScore(2, 2), 'volume raises score but damped')
})

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

test('store: retention pruning removes old traces and stale uncompiled patterns', () => {
  const store = new DeepJitStore(':memory:')
  const now = 100_000
  store.upsertSession('s1', 1)
  store.insertTraces([
    { session_id: 's1', turn: 1, step: 0, kind: 'tool', seq: 1, ts_ms: 1000, payload: '{"name":"old"}' },
    { session_id: 's1', turn: 1, step: 1, kind: 'tool', seq: 2, ts_ms: 99_000, payload: '{"name":"new"}' },
  ])
  store.upsertPattern('flow-seq', 'old>old', 3, 2, 's1', 1000)
  store.upsertPattern('flow-seq', 'new>new', 3, 2, 's1', 99_000)

  const t = store.pruneTraces(7000, now)
  const p = store.prunePatterns(7000, now)
  assert.equal(t, 1, 'old trace removed')
  assert.equal(p, 1, 'stale uncompiled pattern removed')
  assert.equal(store.readTracesSince('s1', 0, ['tool']).length, 1)
  assert.ok(store.getPatternByKey('flow-seq', 'new>new'), 'recent pattern kept')
  store.close()
})

test('store: gc disables stale unused artifacts only', () => {
  const store = new DeepJitStore(':memory:')
  const now = 100_000
  store.insertArtifact({ type: 'flow', name: 'deepjit-old-unused', file_path: '/tmp/a.json', status: 'active', created_ms: 1000 })
  store.insertArtifact({ type: 'flow', name: 'deepjit-recent', file_path: '/tmp/b.json', status: 'active', created_ms: 99_900 })
  store.insertArtifact({ type: 'flow', name: 'deepjit-old-used', file_path: '/tmp/c.json', status: 'active', created_ms: 1000 })
  store.recordUsage('deepjit-old-used', 99_900)

  const removed = store.gcStale(now, 1000, 500)
  assert.deepEqual(removed, ['deepjit-old-unused'])
  assert.equal(store.getArtifact('deepjit-old-unused')!.status, 'disabled')
  assert.equal(store.getArtifact('deepjit-recent')!.status, 'active', 'protection window keeps recent')
  assert.equal(store.getArtifact('deepjit-old-used')!.status, 'active', 'recently used kept')
  assert.equal(store.getArtifact('deepjit-old-used')!.use_count, 1)
  store.close()
})
