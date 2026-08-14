import { appendFileSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/cordis-plugin-timer'
import { Config, type DeepJitConfig } from './config.ts'
export { Config } from './config.ts'
import { DeepJitStore } from './store.ts'
import { TraceCollector } from './collector.ts'
import { mineHotPatterns } from './miner.ts'
import { Summarizer } from './summarizer.ts'
import { ArtifactFeedback } from './feedback.ts'
import { FlowExecutor } from './flow-executor.ts'
import { StatusTool } from './status-tool.ts'
import { resolveDirs } from './paths.ts'
import { setLocale } from './i18n.ts'
import { runTiering } from './compiler/tiering.ts'

export const name = 'deepjit'
export const inject = ['llm', 'skills', 'tools', 'sessionPersistence', 'timer']

const callIdFactory: (uuid: string) => unknown = (uuid) => CallId(uuid)

/**
 * Best-effort read of the harness locale (web client `locale` settings
 * namespace). Returns undefined when absent (e.g. headless), letting i18n
 * fall back to the environment, then English.
 */
function readDshLocale(ctx: Context): unknown {
  try {
    const value = (ctx as unknown as { settings?: { scope?: (ns: string) => { get?: () => unknown } } })
      .settings?.scope?.('locale')?.get?.()
    if (value && typeof value === 'object' && 'preference' in value) {
      return (value as { preference?: unknown }).preference
    }
  } catch {
    // dsh locale is optional
  }
  return undefined
}

export function apply(ctx: Context, config: DeepJitConfig) {
  if (!config.enabled) return
  setLocale(config.locale, readDshLocale(ctx))

  const dirs = resolveDirs(ctx, config)
  const store = new DeepJitStore(dirs.dbPath)
  const collector = new TraceCollector(
    store,
    () => collector.flushSync(),
    config.maxResultChars,
    config.flushBatchSize,
    config.maxPendingCalls,
  )

  const log = (msg: string) => {
    ;(ctx as unknown as { logger?: { info: (m: string) => void } }).logger?.info(msg)
    try {
      appendFileSync(pathJoin(dirs.home, 'deepjit', 'deepjit.log'), `${new Date().toISOString()} ${msg}\n`)
    } catch {
      // logging is best-effort
    }
  }

  const skillsService = (ctx as unknown as {
    skills?: {
      register(s: { name: string; description: string; whenToUse?: string; content: string }): () => void
      get(name: string): Promise<unknown>
    }
  }).skills
  const skillsAdapter = skillsService
    ? {
        register: (s: { name: string; description: string; whenToUse?: string; content: string }) => skillsService.register(s),
        get: (name: string) => skillsService.get(name),
        on: (event: string, handler: () => void) => {
          const off = (ctx as unknown as { on: (e: string, h: () => void) => unknown }).on(event, handler)
          return () => {
            if (typeof off === 'function') off()
          }
        },
      }
    : { register: () => () => {}, get: async () => undefined, on: () => () => {} }
  const feedback = new ArtifactFeedback(
    { skillDir: dirs.skillDir, flowDir: dirs.flowDir },
    skillsAdapter,
    log,
  )

  const persistence = (ctx as unknown as {
    sessionPersistence?: { readFrom(id: unknown, fromSeq: number, signal?: AbortSignal): Promise<{ events: unknown[] }> }
  }).sessionPersistence

  const llm = (ctx as unknown as {
    llm: { stream(o: unknown): AsyncIterable<unknown> }
  }).llm
  const tools = (ctx as unknown as {
    tools: { execute(o: unknown): Promise<unknown>; get(name: string): unknown }
  }).tools
  const summarizer = new Summarizer(
    store,
    {
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      maxResultChars: config.maxResultChars,
      minRepeat: config.minRepeat,
      topK: config.topK,
      minFlowSteps: config.minFlowSteps,
      minPatternValue: config.minPatternValue,
      transcriptMaxRows: config.transcriptMaxRows,
    },
    { stream: (o) => llm.stream(o) },
    persistence,
    (artifact) => feedback.publish(artifact),
    log,
    { toolExists: (name) => name === 'deepjit_flow' || tools.get(name) !== undefined },
  )

  const flowExecutor = new FlowExecutor(
    dirs.flowDir,
    store,
    (input) => tools.execute(input),
    callIdFactory,
    config.stepTimeoutMs,
    config.maxResultChars,
    log,
  )
  const statusTool = new StatusTool(store, feedback, dirs, log)

  // capture
  ctx.on('session/event', (session, event) => {
    collector.handleEvent(session?.id, event)
  })
  ctx.on('tools/result', (exec, result) => {
    collector.handleToolResult(exec, result)
  })
  ctx.on('session/flush', () => collector.flushSync())
  ctx.interval(() => collector.flushSync(), config.flushIntervalMs)

  // JIT cycle: mine hot paths, then compile the strongest ones
  ctx.interval(() => {
    mineHotPatterns(store, {
      ngramMin: config.ngramMin,
      ngramMax: config.ngramMax,
      maxRows: config.minerMaxRows,
    })
    if (config.gcEnabled) {
      const removed = store.gcStale(Date.now(), config.gcStaleMs, config.gcProtectMs)
      for (const name of removed) log(`deepjit: gc disabled stale artifact ${name}`)
      const prunedTraces = store.pruneTraces(config.traceRetentionMs)
      const prunedPatterns = store.prunePatterns(config.patternRetentionMs)
      if (prunedTraces > 0) log(`deepjit: pruned ${prunedTraces} old trace rows`)
      if (prunedPatterns > 0) log(`deepjit: pruned ${prunedPatterns} stale patterns`)
    }
    const tier = runTiering(store, {
      deoptMinUses: config.deoptMinUses,
      deoptMaxSuccessRate: config.deoptMaxSuccessRate,
      promoteMinUses: config.promoteMinUses,
      promoteMinSuccessRate: config.promoteMinSuccessRate,
    })
    for (const name of tier.deopted) log(`deepjit: deoptimized unreliable flow ${name}`)
    for (const skill of tier.promote) {
      if (skill.source_pattern_id == null) continue
      void summarizer
        .compilePatternAsFlow(skill.source_pattern_id)
        .catch((err) => log(`deepjit: promotion error: ${(err as Error).message}`))
    }
    if (!summarizer.shouldRun(config.minIntervalMs)) return
    void summarizer.run().catch((err) => log(`deepjit: jit run failed: ${(err as Error).message}`))
  }, config.summarizeIntervalMs)

  // tools exposed to agents
  ;(ctx as unknown as { tools: { register(d: object): void } }).tools.register(flowExecutor.toolDefinition)
  ;(ctx as unknown as { tools: { register(d: object): void } }).tools.register(statusTool.toolDefinition)

  ctx.effect(() => async () => {
    collector.flushSync()
    const deadline = Date.now() + 10_000
    while (summarizer.busy && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    feedback.disposeAll()
    store.close()
  })
}
