import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DeepJitStore } from '../src/store.ts'
import { buildStatusPayload, registerStatusRoutes, STATUS_PATH } from '../src/status-routes.ts'

test('status-routes: buildStatusPayload maps rows and hides host paths / session ids', () => {
  const store = new DeepJitStore(':memory:')
  store.insertArtifact({ type: 'flow', name: 'deepjit-x', description: 'd', file_path: '/nonexistent/x.json', status: 'active' })
  store.recordUsage('deepjit-x')
  store.recordOutcome('deepjit-x', true)
  store.upsertPattern('flow-seq', 'a>b', 3, 2, 's1', 1000)

  const payload = buildStatusPayload(store)
  assert.equal(payload.artifacts.length, 1)
  const a = payload.artifacts[0]!
  assert.equal(a.name, 'deepjit-x')
  assert.equal(a.type, 'flow')
  assert.equal(a.fileOk, false, 'nonexistent file_path -> fileOk false')
  assert.equal(a.quality, 1, 'qualityScore(1,1) = 1')
  assert.equal(a.use_count, 1)
  assert.equal('file_path' in a, false, 'host path never reaches the browser')

  assert.equal(payload.patterns.length, 1)
  const p = payload.patterns[0]!
  assert.equal(p.key, 'a>b')
  assert.equal(p.count, 3)
  assert.equal('sample_session' in p, false, 'session id never reaches the browser')

  assert.equal(payload.stats.artifacts, 1)
  assert.equal(typeof payload.metrics, 'object')
  store.close()
})

test('status-routes: registers GET status route and serves the JSON payload', async () => {
  const store = new DeepJitStore(':memory:')
  store.insertArtifact({ type: 'skill', name: 'deepjit-y', description: 'd', file_path: '/no/y.md' })
  const routes: { path: string; methods: string[]; fetch: (r: Request) => Promise<Response> }[] = []
  const ctx = {
    connection: { fetch: { register: (r: (typeof routes)[number]) => { routes.push(r); return async () => {} } } },
  }
  registerStatusRoutes(ctx as unknown as Parameters<typeof registerStatusRoutes>[0], { store, log: () => {} })
  assert.equal(routes.length, 1)
  assert.equal(routes[0]!.path, STATUS_PATH)
  assert.deepEqual(routes[0]!.methods, ['GET'])

  const res = await routes[0]!.fetch(new Request('http://x/api/deepjit/status'))
  assert.equal(res.status, 200)
  const body = await res.json() as { artifacts: { name: string }[] }
  assert.equal(body.artifacts.length, 1)
  assert.equal(body.artifacts[0]!.name, 'deepjit-y')
  store.close()
})

test('status-routes: no-op when the connection service is absent (headless)', () => {
  const store = new DeepJitStore(':memory:')
  assert.doesNotThrow(() =>
    registerStatusRoutes({} as unknown as Parameters<typeof registerStatusRoutes>[0], { store, log: () => {} }),
  )
  store.close()
})