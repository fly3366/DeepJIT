import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metrics } from '../src/metrics.ts'

test('metrics: counters accumulate and snapshot flattens timings', () => {
  metrics.reset()
  metrics.inc('flushes')
  metrics.inc('traces_flushed', 5)
  metrics.inc('traces_flushed', 3)
  metrics.observe('llm_latency', 100)
  metrics.observe('llm_latency', 300)

  const snap = metrics.snapshot()
  assert.equal(snap['flushes'], 1)
  assert.equal(snap['traces_flushed'], 8)
  assert.equal(snap['llm_latency.count'], 2)
  assert.equal(snap['llm_latency.sum_ms'], 400)
  assert.equal(snap['llm_latency.max_ms'], 300)
  assert.equal(snap['llm_latency.avg_ms'], 200)
  metrics.reset()
})

test('metrics: reset clears state', () => {
  metrics.inc('x')
  metrics.reset()
  assert.equal(metrics.get('x'), 0)
  assert.deepEqual(metrics.snapshot(), {})
})
