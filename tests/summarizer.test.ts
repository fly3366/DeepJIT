import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DeepJitStore } from '../src/store.js'
import { Summarizer } from '../src/summarizer.js'

function seedHotPattern(store: DeepJitStore, sid = 's1'): void {
  store.upsertSession(sid, 1)
  store.insertTraces([
    { session_id: sid, turn: 1, step: 0, kind: 'user', seq: 1, ts_ms: 1, payload: '{"text":"summarize repo"}' },
    { session_id: sid, turn: 1, step: 1, kind: 'tool', seq: 2, ts_ms: 2, payload: '{"name":"read_file","args":"{\\"path\\":\\"/a\\"}"}' },
    { session_id: sid, turn: 1, step: 2, kind: 'tool', seq: 3, ts_ms: 3, payload: '{"name":"write_file","args":"{\\"path\\":\\"/b\\"}"}' },
  ])
  store.upsertPattern('flow-seq', 'read_file>write_file', 4, 2, sid, 1000)
}

function fakeLlm(text: string) {
  return {
    async *stream(): AsyncIterable<unknown> {
      yield { type: 'text-delta', text }
    },
  }
}

test('summarizer: compiles a flow artifact from a hot pattern', async () => {
  const store = new DeepJitStore(':memory:')
  seedHotPattern(store)
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-test-'))
  const flowDir = path.join(dir, 'flows')
  const publish = async (a: { name: string; sourcePatternId: number }) => ({
    mode: 'filesystem' as const,
    filePath: path.join(flowDir, `${a.name}.json`),
    name: a.name,
  })
  const s = new Summarizer(
    store,
    { llmProvider: 'p', llmModel: 'm', maxResultChars: 500, minRepeat: 3, topK: 5 },
    fakeLlm(JSON.stringify({
      type: 'flow',
      name: 'summarize-repo',
      description: 'Summarize a repository',
      steps: [{ tool: 'read_file', args: { path: '${input.path}' } }, { tool: 'write_file', args: { path: '/b' }, onError: 'stop' }],
    })),
    undefined,
    publish,
    () => {},
  )
  const n = await s.run()
  assert.equal(n, 1)
  const artifact = store.getArtifact('summarize-repo')
  assert.ok(artifact, 'artifact row exists')
  assert.equal(artifact!.type, 'flow')
  assert.equal(store.getHotPatterns('flow-seq', 3, 2, 10).length, 0, 'pattern marked compiled')
  rmSync(dir, { recursive: true, force: true })
})

test('summarizer: rejects invalid LLM output and retries', async () => {
  const store = new DeepJitStore(':memory:')
  seedHotPattern(store)
  let calls = 0
  const s = new Summarizer(
    store,
    { llmProvider: 'p', llmModel: 'm', maxResultChars: 500, minRepeat: 3, topK: 5 },
    {
      async *stream(): AsyncIterable<unknown> {
        calls++
        if (calls === 1) yield { type: 'text-delta', text: 'not json at all' }
        else yield { type: 'text-delta', text: JSON.stringify({ type: 'flow', name: 'bad name!', description: 'x', steps: [] }) }
      },
    },
    undefined,
    async () => ({ mode: 'filesystem' as const, filePath: '/tmp/x.json', name: 'deepjit-x' }),
    () => {},
  )
  const n = await s.run()
  assert.equal(n, 0, 'no artifact for invalid outputs')
  assert.equal(calls, 2, 'retried once')
  store.close()
})

test('summarizer: drills down via sessionPersistence when available', async () => {
  const store = new DeepJitStore(':memory:')
  seedHotPattern(store)
  let drilled = false
  const s = new Summarizer(
    store,
    { llmProvider: 'p', llmModel: 'm', maxResultChars: 500, minRepeat: 3, topK: 5 },
    fakeLlm(JSON.stringify({ type: 'skill', name: 'repo-guide', description: 'guide', content: '# Guide\nDo things.' })),
    {
      async readFrom() {
        drilled = true
        return {
          events: [
            { type: 'user/message', data: { content: [{ type: 'text', text: 'full user text' }] } },
            { type: 'tool/call', data: { name: 'read_file', arguments: '{"path":"/a"}' } },
            { type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'full result' }] } } },
          ],
        }
      },
    },
    async (a) => ({ mode: 'filesystem' as const, filePath: `/tmp/${a.name}/SKILL.md`, name: a.name }),
    () => {},
  )
  const n = await s.run()
  assert.equal(n, 1)
  assert.equal(drilled, true)
  const artifact = store.getArtifact('repo-guide')
  assert.equal(artifact!.type, 'skill')
  store.close()
})
