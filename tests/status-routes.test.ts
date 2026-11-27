import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DeepJitStore } from '../src/store.ts'
import { ArtifactFeedback } from '../src/feedback.ts'
import { StatusTool } from '../src/status-tool.ts'
import {
  buildStatusPayload, registerStatusRoutes, STATUS_PATH, ACTION_PATH, isValidArtifactName,
} from '../src/status-routes.ts'

interface Route { path: string; methods: string[]; fetch: (r: Request) => Promise<Response> }

function makeCtx(routes: Route[]) {
  return { connection: { fetch: { register: (r: Route) => { routes.push(r); return async () => {} } } } }
}

const stubSkills = { register: () => () => {}, get: async () => undefined, on: () => () => {} }

function makeDeps(store: DeepJitStore, dir: string) {
  const dirs = { skillDir: path.join(dir, 'skills'), flowDir: path.join(dir, 'flows') }
  const feedback = new ArtifactFeedback(dirs, stubSkills, () => {})
  const statusTool = new StatusTool(store, feedback, dirs, () => {})
  return { store, statusTool, log: () => {}, feedback, dirs }
}

function post(routes: Route[], body: string) {
  const r = routes.find((x) => x.path === ACTION_PATH)!
  return r.fetch(new Request('http://x/api/deepjit/action', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  }))
}
const postJson = (routes: Route[], obj: unknown) => post(routes, JSON.stringify(obj))

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
  assert.equal(a.fileOk, false)
  assert.equal(a.quality, 1)
  assert.equal('file_path' in a, false, 'host path never reaches the browser')
  assert.equal(payload.patterns.length, 1)
  assert.equal('sample_session' in payload.patterns[0]!, false, 'session id never reaches the browser')
  assert.equal(payload.stats.artifacts, 1)
  store.close()
})

test('status-routes: registers GET + POST routes and serves the JSON payload', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-rt-'))
  const store = new DeepJitStore(':memory:')
  store.insertArtifact({ type: 'skill', name: 'deepjit-y', description: 'd', file_path: '/no/y.md' })
  const routes: Route[] = []
  registerStatusRoutes(makeCtx(routes) as never, makeDeps(store, dir))
  assert.deepEqual(routes.map((r) => r.path).sort(), [ACTION_PATH, STATUS_PATH].sort())
  const get = routes.find((r) => r.path === STATUS_PATH)!
  assert.deepEqual(get.methods, ['GET'])
  const res = await get.fetch(new Request('http://x/api/deepjit/status'))
  assert.equal(res.status, 200)
  const body = await res.json() as { artifacts: { name: string }[] }
  assert.equal(body.artifacts[0]!.name, 'deepjit-y')
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('status-routes: no-op when the connection service is absent (headless)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-rt-'))
  const store = new DeepJitStore(':memory:')
  const routes: Route[] = []
  assert.doesNotThrow(() => registerStatusRoutes({} as never, makeDeps(store, dir)))
  assert.equal(routes.length, 0)
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('status-routes: isValidArtifactName accepts kebab, rejects traversal / separators', () => {
  assert.equal(isValidArtifactName('deepjit-summarize-repo'), true)
  assert.equal(isValidArtifactName('a'), true)
  for (const bad of ['../x', 'a/b', '..', '.hidden', '', 'UPPER', 'a b', 'a\\b', 'x'.repeat(201)]) {
    assert.equal(isValidArtifactName(bad), false, `rejects ${JSON.stringify(bad)}`)
  }
  assert.equal(isValidArtifactName(null), false)
  assert.equal(isValidArtifactName(42), false)
})

test('status-routes: POST disable/enable/delete mutate store and return ok', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-rt-'))
  const store = new DeepJitStore(':memory:')
  store.insertArtifact({ type: 'flow', name: 'deepjit-a', description: 'd', file_path: path.join(dir, 'flows', 'deepjit-a.json'), status: 'active' })
  const routes: Route[] = []
  registerStatusRoutes(makeCtx(routes) as never, makeDeps(store, dir))

  let res = await postJson(routes, { action: 'disable', name: 'deepjit-a' })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, code: 'ok' })
  assert.equal(store.getArtifact('deepjit-a')!.status, 'disabled')

  res = await postJson(routes, { action: 'enable', name: 'deepjit-a' })
  assert.equal(res.status, 200)
  assert.equal(store.getArtifact('deepjit-a')!.status, 'active')

  res = await postJson(routes, { action: 'delete', name: 'deepjit-a' })
  assert.equal(res.status, 200)
  assert.equal(store.getArtifact('deepjit-a'), undefined)
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('status-routes: POST disable renames the flow file to .disabled', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-rt-'))
  const store = new DeepJitStore(':memory:')
  const flowFile = path.join(dir, 'flows', 'deepjit-f.json')
  mkdirSync(path.dirname(flowFile), { recursive: true })
  writeFileSync(flowFile, '{}')
  store.insertArtifact({ type: 'flow', name: 'deepjit-f', description: 'd', file_path: flowFile, status: 'active' })
  const routes: Route[] = []
  registerStatusRoutes(makeCtx(routes) as never, makeDeps(store, dir))
  const res = await postJson(routes, { action: 'disable', name: 'deepjit-f' })
  assert.equal(res.status, 200)
  assert.equal(existsSync(flowFile), false)
  assert.equal(existsSync(`${flowFile}.disabled`), true)
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('status-routes: POST rejects unknown name, traversal, invalid action, bad body', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-rt-'))
  const store = new DeepJitStore(':memory:')
  store.insertArtifact({ type: 'flow', name: 'deepjit-a', description: 'd', file_path: '/no/a.json', status: 'active' })
  const routes: Route[] = []
  registerStatusRoutes(makeCtx(routes) as never, makeDeps(store, dir))

  let res = await postJson(routes, { action: 'disable', name: 'deepjit-missing' })
  assert.equal(res.status, 400)
  assert.equal((await res.json() as { code: string }).code, 'unknown')

  for (const bad of ['../x', 'a/b', '..']) {
    res = await postJson(routes, { action: 'delete', name: bad })
    assert.equal(res.status, 400)
    assert.equal((await res.json() as { code: string }).code, 'invalid-name')
  }
  assert.equal(store.getArtifact('deepjit-a')!.status, 'active', 'traversal never mutated state')

  res = await postJson(routes, { action: 'explode', name: 'deepjit-a' })
  assert.equal(res.status, 400)
  assert.equal((await res.json() as { code: string }).code, 'invalid-action')

  res = await post(routes, 'not json')
  assert.equal(res.status, 400)
  assert.equal((await res.json() as { code: string }).code, 'invalid-body')
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('status-routes: POST idempotence codes (already-disabled / already-active)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-rt-'))
  const store = new DeepJitStore(':memory:')
  store.insertArtifact({ type: 'flow', name: 'deepjit-a', description: 'd', file_path: '/no/a.json', status: 'disabled' })
  const routes: Route[] = []
  registerStatusRoutes(makeCtx(routes) as never, makeDeps(store, dir))
  let res = await postJson(routes, { action: 'disable', name: 'deepjit-a' })
  assert.equal((await res.json() as { code: string }).code, 'already-disabled')
  store.updateArtifactStatus('deepjit-a', 'active')
  res = await postJson(routes, { action: 'enable', name: 'deepjit-a' })
  assert.equal((await res.json() as { code: string }).code, 'already-active')
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

test('status-routes: POST sanitizes feedback errors (no host path in response)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-rt-'))
  const store = new DeepJitStore(':memory:')
  store.insertArtifact({ type: 'flow', name: 'deepjit-a', description: 'd', file_path: '/no/a.json', status: 'active' })
  const throwingFeedback = { disable: () => { throw new Error('boom at /secret/host/path') }, enable: () => {}, remove: () => {} }
  const statusTool = new StatusTool(store, throwingFeedback as never, { skillDir: dir, flowDir: dir }, () => {})
  const routes: Route[] = []
  registerStatusRoutes(makeCtx(routes) as never, { store, statusTool, log: () => {} })
  const res = await postJson(routes, { action: 'disable', name: 'deepjit-a' })
  assert.equal(res.status, 500)
  const text = await res.text()
  assert.equal(JSON.parse(text).code, 'action-failed')
  assert.equal(text.includes('/secret/host/path'), false, 'host path never leaks to the browser')
  store.close()
  rmSync(dir, { recursive: true, force: true })
})