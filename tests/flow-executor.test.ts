import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DeepJitStore } from '../src/store.ts'
import { FlowExecutor } from '../src/flow-executor.ts'
import { setLocale } from '../src/i18n.ts'

setLocale('en')

function setup(store: DeepJitStore, flowDir: string, name: string, steps: unknown[]): void {
  writeFileSync(path.join(flowDir, `${name}.json`), JSON.stringify({ name, steps }))
  store.insertArtifact({
    type: 'flow',
    name,
    description: 'test flow',
    file_path: path.join(flowDir, `${name}.json`),
    status: 'active',
  })
}

test('flow executor: resolves ${input.x} and runs steps with retry', async () => {
  const store = new DeepJitStore(':memory:')
  const flowDir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-flow-'))
  setup(store, flowDir, 'deepjit-test-flow', [
    { tool: 'echo', args: { msg: '${input.msg}' }, onError: 'retry' },
    { tool: 'noop', args: { n: 1 } },
  ])
  let calls = 0
  const executor = new FlowExecutor(
    flowDir,
    store,
    async (input) => {
      calls++
      const args = input.arguments as { msg?: string }
      if (calls < 3) return { isError: true, error: { message: 'transient' } }
      if (typeof args.msg === 'string') assert.equal(args.msg, 'hello deepjit')
      return { isError: false, value: { ok: true }, content: [{ type: 'text', text: 'echoed' }] }
    },
    (uuid) => uuid,
    1000,
    500,
    () => {},
  )
  const res = await executor.run('deepjit-test-flow', { msg: 'hello deepjit' }, undefined, new AbortController().signal)
  assert.equal(res.ok, true)
  assert.equal(res.steps.length, 2)
  assert.equal(calls, 4, 'first step retried twice plus the second step')
  rmSync(flowDir, { recursive: true, force: true })
  store.close()
})

test('flow executor: onError stop aborts remaining steps', async () => {
  const store = new DeepJitStore(':memory:')
  const flowDir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-flow-'))
  setup(store, flowDir, 'deepjit-stop-flow', [
    { tool: 'boom', args: {}, onError: 'stop' },
    { tool: 'never', args: {} },
  ])
  let calls = 0
  const executor = new FlowExecutor(
    flowDir,
    store,
    async () => {
      calls++
      return { isError: true, error: { message: 'hard fail' } }
    },
    (uuid) => uuid,
    1000,
    500,
    () => {},
  )
  const res = await executor.run('deepjit-stop-flow', {}, undefined, new AbortController().signal)
  assert.equal(res.ok, false)
  assert.equal(calls, 1, 'second step never ran')
  rmSync(flowDir, { recursive: true, force: true })
  store.close()
})

test('flow executor: rejects unknown or disabled flows', async () => {
  const store = new DeepJitStore(':memory:')
  const flowDir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-flow-'))
  setup(store, flowDir, 'deepjit-disabled', [{ tool: 'a', args: {} }])
  store.updateArtifactStatus('deepjit-disabled', 'disabled')
  const executor = new FlowExecutor(
    flowDir,
    store,
    async () => ({ isError: false, value: null }),
    (uuid) => uuid,
    1000,
    500,
    () => {},
  )
  await assert.rejects(() => executor.run('nope', {}, undefined, new AbortController().signal), /unknown flow/)
  await assert.rejects(() => executor.run('deepjit-disabled', {}, undefined, new AbortController().signal), /disabled/)
  rmSync(flowDir, { recursive: true, force: true })
  store.close()
})

test('flow executor: supports nested deepjit_flow with child input', async () => {
  const store = new DeepJitStore(':memory:')
  const flowDir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-flow-'))
  setup(store, flowDir, 'deepjit-child', [{ tool: 'echo', args: { msg: '${input.msg}' } }])
  setup(store, flowDir, 'deepjit-parent', [
    { tool: 'deepjit_flow', args: { flow: 'deepjit-child', args: { msg: '${input.msg}' } }, onError: 'stop' },
  ])
  const seen: unknown[] = []
  const executor = new FlowExecutor(
    flowDir,
    store,
    async (input) => { seen.push(input.arguments); return { isError: false, value: { ok: true }, content: [{ type: 'text', text: 'ok' }] } },
    (uuid) => uuid,
    1000,
    500,
    () => {},
  )
  const res = await executor.run('deepjit-parent', { msg: 'hi' }, undefined, new AbortController().signal)
  assert.equal(res.ok, true)
  assert.deepEqual(seen, [{ msg: 'hi' }], 'child received the nested input')
  rmSync(flowDir, { recursive: true, force: true })
  store.close()
})

test('flow executor: rejects deepjit_status steps', async () => {
  const store = new DeepJitStore(':memory:')
  const flowDir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-flow-'))
  setup(store, flowDir, 'deepjit-bad', [{ tool: 'deepjit_status', args: { action: 'list' } }])
  const executor = new FlowExecutor(flowDir, store, async () => ({ isError: false, value: null }), (u) => u, 1000, 500, () => {})
  await assert.rejects(
    () => executor.run('deepjit-bad', {}, undefined, new AbortController().signal),
    /recursive|deepjit/,
  )
  rmSync(flowDir, { recursive: true, force: true })
  store.close()
})
