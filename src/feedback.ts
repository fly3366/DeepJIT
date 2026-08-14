import { mkdirSync, writeFileSync, renameSync, rmSync, existsSync, readFileSync, watch } from 'node:fs'
import path from 'node:path'
import type { CompiledArtifact } from './summarizer.ts'
import { SKILL_PREFIX } from './summarizer.ts'

export interface SkillRegistryLike {
  register(skill: { name: string; description: string; whenToUse?: string; content: string }): () => void
  get(name: string): Promise<unknown>
  on(event: 'skills/change', handler: () => void): (() => void) | void
}

function skillFrontmatter(name: string, description: string, whenToUse?: string): string {
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${description.replace(/\n/g, ' ')}`,
  ]
  if (whenToUse) lines.push(`whenToUse: ${whenToUse.replace(/\n/g, ' ')}`)
  lines.push('---', '')
  return lines.join('\n')
}

/**
 * Writes compiled artifacts to the isolated deepjit directory and makes them
 * live in dsh: mechanism A relies on the skill-filesystem provider watching
 * the directory (customSkillDirs in cordis.patch.yml); mechanism B registers
 * the skill at runtime when A is not in effect.
 */
export class ArtifactFeedback {
  private runtimeRegistrations = new Map<string, () => void>()
  private watchers = new Map<string, () => void>()
  private dirs: { skillDir: string; flowDir: string }
  private skills: SkillRegistryLike
  private log: (msg: string) => void

  constructor(
    dirs: { skillDir: string; flowDir: string },
    skills: SkillRegistryLike,
    log: (msg: string) => void,
  ) {
    this.dirs = dirs
    this.skills = skills
    this.log = log
  }

  async publish(artifact: CompiledArtifact): Promise<{ mode: 'filesystem' | 'runtime'; filePath: string; name: string }> {
    const name = `${SKILL_PREFIX}${artifact.name}`
    if (artifact.type === 'skill') {
      const filePath = path.join(this.dirs.skillDir, name, 'SKILL.md')
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, skillFrontmatter(name, artifact.description, artifact.whenToUse) + (artifact.content ?? ''))
      this.log(`deepjit: wrote skill ${name} -> ${filePath}`)
      return { mode: await this.waitForDiscovery(name, artifact), filePath, name }
    }
    const filePath = path.join(this.dirs.flowDir, `${name}.json`)
    mkdirSync(this.dirs.flowDir, { recursive: true })
    writeFileSync(filePath, JSON.stringify({
      name,
      description: artifact.description,
      whenToUse: artifact.whenToUse,
      steps: artifact.steps,
      createdAt: Date.now(),
    }, null, 2))
    this.log(`deepjit: wrote flow ${name} -> ${filePath}`)
    return { mode: 'filesystem', filePath, name }
  }

  private async waitForDiscovery(name: string, artifact: CompiledArtifact): Promise<'filesystem' | 'runtime'> {
    const timeoutMs = 2000
    const deadline = Date.now() + timeoutMs
    const done = new Promise<'filesystem' | 'runtime'>((resolve) => {
      let settled = false
      const finish = (mode: 'filesystem' | 'runtime') => {
        if (!settled) {
          settled = true
          off?.()
          resolve(mode)
        }
      }
      const check = async () => {
        try {
          if (await this.skills.get(name)) return finish('filesystem')
        } catch {
          // not visible yet
        }
        if (Date.now() >= deadline) {
          this.registerRuntime(name, artifact)
          return finish('runtime')
        }
        poll = setTimeout(check, 250)
      }
      const off = this.skills.on('skills/change', () => void check())
      let poll: ReturnType<typeof setTimeout>
      void check()
      return () => {
        if (poll) clearTimeout(poll)
        off?.()
      }
    })
    return done
  }

  private registerRuntime(name: string, artifact: CompiledArtifact): void {
    if (this.runtimeRegistrations.has(name)) return
    const content = skillFrontmatter(name, artifact.description, artifact.whenToUse) + (artifact.content ?? '')
    const disposer = this.skills.register({
      name,
      description: artifact.description,
      whenToUse: artifact.whenToUse,
      content,
    })
    this.runtimeRegistrations.set(name, disposer)
    const filePath = path.join(this.dirs.skillDir, name, 'SKILL.md')
    const watcher = watch(path.dirname(filePath), (_event, filename) => {
      if (filename !== 'SKILL.md') return
      const next = this.skills.register({
        name,
        description: artifact.description,
        whenToUse: artifact.whenToUse,
        content: readFileSync(filePath, 'utf8'),
      })
      const old = this.runtimeRegistrations.get(name)
      this.runtimeRegistrations.set(name, next)
      old?.()
    })
    watcher.unref?.()
    this.watchers.set(name, () => {
      watcher.close()
      this.runtimeRegistrations.delete(name)
      this.watchers.delete(name)
    })
    this.log(`deepjit: skill ${name} not discovered via filesystem provider, registered at runtime`)
  }

  /** Accept either the prefixed or bare artifact name. */
  private full(name: string): string {
    return name.startsWith(SKILL_PREFIX) ? name : `${SKILL_PREFIX}${name}`
  }

  disable(name: string): void {
    const full = this.full(name)
    this.unregisterRuntime(full)
    const skillPath = path.join(this.dirs.skillDir, full)
    const flowPath = path.join(this.dirs.flowDir, `${full}.json`)
    if (existsSync(skillPath)) renameSync(skillPath, `${skillPath}.disabled`)
    if (existsSync(`${skillPath}.disabled`) && existsSync(skillPath)) rmSync(skillPath, { recursive: true })
    if (existsSync(flowPath)) renameSync(flowPath, `${flowPath}.disabled`)
  }

  /** Reverse of disable. */
  enable(name: string): void {
    const full = this.full(name)
    const skillPath = path.join(this.dirs.skillDir, full)
    const flowPath = path.join(this.dirs.flowDir, `${full}.json`)
    if (existsSync(`${skillPath}.disabled`) && !existsSync(skillPath)) {
      renameSync(`${skillPath}.disabled`, skillPath)
    }
    if (existsSync(`${flowPath}.disabled`) && !existsSync(flowPath)) {
      renameSync(`${flowPath}.disabled`, flowPath)
    }
  }

  remove(name: string): void {
    const full = this.full(name)
    this.unregisterRuntime(full)
    const skillPath = path.join(this.dirs.skillDir, full)
    const flowPath = path.join(this.dirs.flowDir, `${full}.json`)
    for (const p of [skillPath, `${skillPath}.disabled`, flowPath, `${flowPath}.disabled`]) {
      if (existsSync(p)) rmSync(p, { recursive: true })
    }
  }

  private unregisterRuntime(full: string): void {
    const disposer = this.runtimeRegistrations.get(full)
    if (disposer) disposer()
    this.watchers.get(full)?.()
  }

  disposeAll(): void {
    for (const full of [...this.runtimeRegistrations.keys()]) this.unregisterRuntime(full)
  }
}
