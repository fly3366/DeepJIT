import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeepJitStore, type TraceRow } from '../src/store.js'
import { mineHotPatterns, extractKeywords } from '../src/miner.js'

function seedSession(store: DeepJitStore, sid: string, names: string[], userText: string): void {
  store.upsertSession(sid, 1)
  let seq = 1
  const rows: TraceRow[] = names.map((name, i) => ({
    session_id: sid, turn: 1, step: i, kind: 'tool',
    seq: seq++ * 10, ts_ms: seq * 100,
    payload: JSON.stringify({ name }),
  }))
  rows.push({
    session_id: sid, turn: 1, step: 0, kind: 'user',
    seq: seq++ * 10, ts_ms: seq * 100,
    payload: JSON.stringify({ text: userText }),
  })
  store.insertTraces(rows)
}

test('miner: repeated tool sequences become hot patterns across sessions', () => {
  const store = new DeepJitStore(':memory:')
  seedSession(store, 's1', ['a', 'b', 'c', 'a', 'b', 'c'], 'please summarize the repository')
  seedSession(store, 's2', ['a', 'b', 'c'], 'summarize repository code')
  mineHotPatterns(store, { ngramMin: 2, ngramMax: 3 })

  const hot = store.getHotPatterns('flow-seq', 3, 2, 10)
  assert.ok(hot.some((p) => p.key === 'a>b>c' && p.count >= 3 && p.sessions_seen >= 2), JSON.stringify(hot))
  const intent = store.getHotPatterns('intent', 1, 1, 10)
  assert.ok(intent.some((p) => p.key === 'summarize'), JSON.stringify(intent))

  // watermark advanced: no more summarizable sessions
  assert.equal(store.listSummarizableSessions().length, 0)
  store.close()
})

test('miner: not enough repetition stays below threshold', () => {
  const store = new DeepJitStore(':memory:')
  seedSession(store, 's1', ['a', 'b', 'c'], 'one off task')
  mineHotPatterns(store, { ngramMin: 2, ngramMax: 4 })
  assert.equal(store.getHotPatterns('flow-seq', 3, 2, 10).length, 0)
  store.close()
})

test('miner: keyword extraction', () => {
  assert.deepEqual(extractKeywords('Please summarize the repository'), ['summarize', 'repository'])
  assert.ok(extractKeywords('帮我总结仓库的代码').includes('总结'))
})
