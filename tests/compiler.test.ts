import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optimizeFlow } from '../src/compiler/optimize.ts'
import { runTiering } from '../src/compiler/tiering.ts'
import { DeepJitStore } from '../src/store.ts'

test('optimize: rejects flows referencing tools missing from live registry', () => {
  const steps = [{ tool: 'read_file', args: { path: '${input.path}' } }]
  assert.throws(
    () => optimizeFlow(steps, { toolExists: () => false }),
    /not in live registry/,
  )
})

test('optimize: allows live tools and nested flows, counts folded vs dynamic args', () => {
  const steps = [
    { tool: 'read_file', args: { path: '${input.path}', encoding: 'utf8' } },
    { tool: 'deepjit_flow', args: { flow: 'child', args: { msg: '${input.msg}' } } },
  ]
  const out = optimizeFlow(steps, { toolExists: (n) => n === 'read_file' })
  assert.equal(out.steps.length, 2)
  // read_file: 1 dynamic (path) + 1 folded (encoding); deepjit_flow: 1 dynamic (msg) + 1 folded (flow)
  assert.equal(out.dynamicBindings, 2)
  assert.equal(out.foldedLiterals, 2)
})

test('tiering: deopts unreliable flows and lists promotable skills', () => {
  const store = new DeepJitStore(':memory:')
  // Unreliable flow: 6 uses, 1 success (rate ~0.17 <= 0.5) -> deopt.
  store.insertArtifact({ type: 'flow', name: 'deepjit-bad', file_path: '/tmp/b.json', status: 'active', created_ms: 1 })
  for (let i = 0; i < 6; i++) store.recordUsage('deepjit-bad', 1000)
  store.recordOutcome('deepjit-bad', true)
  // Promotable skill: 6 uses, 6 successes, has source pattern.
  store.insertArtifact({ type: 'skill', name: 'deepjit-hot', file_path: '/tmp/h.md', status: 'active', created_ms: 1, source_pattern_id: 7 })
  for (let i = 0; i < 6; i++) { store.recordUsage('deepjit-hot', 1000); store.recordOutcome('deepjit-hot', true) }

  const res = runTiering(store, { deoptMinUses: 5, deoptMaxSuccessRate: 0.5, promoteMinUses: 5, promoteMinSuccessRate: 0.8 })
  assert.deepEqual(res.deopted, ['deepjit-bad'])
  assert.equal(store.getArtifact('deepjit-bad')!.status, 'disabled')
  assert.equal(res.promote.length, 1)
  assert.equal(res.promote[0]!.name, 'deepjit-hot')
  store.close()
})
