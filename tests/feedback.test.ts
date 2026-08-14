import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ArtifactFeedback } from '../src/feedback.ts'
import type { CompiledArtifact } from '../src/summarizer.ts'

interface StubSkill {
  name: string
  description: string
  content: string
}

function makeStub(getImpl: (name: string) => Promise<unknown>) {
  const registered: StubSkill[] = []
  const disposed: string[] = []
  return {
    registered,
    disposed,
    register(skill: StubSkill) {
      registered.push(skill)
      return () => disposed.push(skill.name)
    },
    get: getImpl,
    on() {
      return () => {}
    },
  }
}

function skillArtifact(name: string): CompiledArtifact {
  return { type: 'skill', name, title: name, description: 'd', content: '# body', summary: 's', sourcePatternId: 1 }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('feedback: falls back to runtime registration when filesystem discovery times out', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-fb-'))
  const stub = makeStub(async () => undefined) // never discovered via filesystem
  const fb = new ArtifactFeedback(
    { skillDir: path.join(dir, 'skills'), flowDir: path.join(dir, 'flows') },
    stub,
    () => {},
  )
  const res = await fb.publish(skillArtifact('runtime-only'))
  assert.equal(res.mode, 'runtime')
  assert.equal(res.name, 'deepjit-runtime-only')
  assert.equal(stub.registered.length, 1, 'registered at runtime')
  assert.equal(stub.registered[0]!.name, 'deepjit-runtime-only')
  fb.disposeAll()
  rmSync(dir, { recursive: true, force: true })
})

test('feedback: watcher re-registers on SKILL.md change and disposes old registration', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-fb-'))
  const stub = makeStub(async () => undefined)
  const fb = new ArtifactFeedback(
    { skillDir: path.join(dir, 'skills'), flowDir: path.join(dir, 'flows') },
    stub,
    () => {},
  )
  await fb.publish(skillArtifact('watched'))
  assert.equal(stub.registered.length, 1)

  // Modify SKILL.md to trigger the watcher re-registration.
  const file = path.join(dir, 'skills', 'deepjit-watched', 'SKILL.md')
  writeFileSync(file, '# updated body')
  await sleep(600)
  assert.ok(stub.registered.length >= 2, 're-registered on change')
  assert.ok(stub.disposed.includes('deepjit-watched'), 'old registration disposed')
  fb.disposeAll()
  rmSync(dir, { recursive: true, force: true })
})

test('feedback: disable renames skill dir to .disabled and enable restores it', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'deepjit-fb-'))
  const stub = makeStub(async () => undefined)
  const fb = new ArtifactFeedback(
    { skillDir: path.join(dir, 'skills'), flowDir: path.join(dir, 'flows') },
    stub,
    () => {},
  )
  await fb.publish(skillArtifact('toggle'))
  const base = path.join(dir, 'skills', 'deepjit-toggle')
  assert.ok(existsSync(base), 'skill dir exists after publish')

  fb.disable('deepjit-toggle')
  assert.ok(!existsSync(base), 'dir renamed away on disable')
  assert.ok(existsSync(`${base}.disabled`), '.disabled present')

  fb.enable('deepjit-toggle')
  assert.ok(existsSync(base), 'dir restored on enable')
  fb.disposeAll()
  rmSync(dir, { recursive: true, force: true })
})
