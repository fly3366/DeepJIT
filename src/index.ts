import type { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-tools'
import '@deepseek-ai/cordis-plugin-timer'
import { Config, type DeepJitConfig } from './config.js'
export { Config } from './config.js'
import { DeepJitStore } from './store.js'
import { TraceCollector } from './collector.js'
import { mineHotPatterns } from './miner.js'
import { Summarizer } from './summarizer.js'
import { ArtifactFeedback } from './feedback.js'
import { FlowExecutor } from './flow-executor.js'
import { StatusTool } from './status-tool.js'
import { resolveDirs } from './paths.js'

export const name = 'deepjit'
export const inject = ['llm', 'skills', 'tools', 'sessionPersistence', 'timer']

const callIdFactory: (uuid: string) => unknown = (uuid) => CallId(uuid)

export function apply(ctx: Context, config: DeepJitConfig) {
  if (!config.enabled) return

  const dirs = resolveDirs(ctx, config)
  const store = new DeepJitStore(dirs.dbPath)
  const collector = new TraceCollector(
    store,
    () => collector.flushSync(),
    config.maxResultChars,
    config.flushBatchSize,
  )

  const log = (msg: string) => (ctx as unknown as { logger?: { info: (m: string) => void } }).logger?.info(msg)

  const skills = (ctx as unknown as {
    skills?: {
      register(s: { name: string; description: string; whenToUse?: string; content: string }): () => void
      get(name: string): Promise<unknown>
      on(event: string, h: () => void): (() => void) | void
    }
  }).skills
  const feedback = new ArtifactFeedback(
    { skillDir: dirs.skillDir, flowDir: dirs.flowDir },
    skills ?? { register: () => () => {}, get: async () => undefined, on: () => () => {} },
    log,
  )

  const persistence = (ctx as unknown as {
    sessionPersistence?: { readFrom(id: unknown, fromSeq: number, signal?: AbortSignal): Promise<{ events: unknown[] }> }
  }).sessionPersistence

  const llm = (ctx as unknown as {
    llm: { stream(o: unknown): AsyncIterable<unknown> }
  }).llm
  const summarizer = new Summarizer(
    store,
    {
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      maxResultChars: config.maxResultChars,
      minRepeat: config.minRepeat,
      topK: config.topK,
    },
    { stream: (o) => llm.stream(o) },
    persistence,
    (artifact) => feedback.publish(artifact),
    log,
  )

  const tools = (ctx as unknown as { tools: { execute(o: unknown): Promise<unknown> } }).tools
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
    const eligible = summarizer.shouldRun(config.minNewTraces, config.minIntervalMs)
    mineHotPatterns(store, config)
    if (!eligible) return
    void summarizer.run()
  }, config.summarizeIntervalMs)

  // tools exposed to agents
  ;(ctx as unknown as { tools: { register(d: object): void } }).tools.register(flowExecutor.toolDefinition)
  ;(ctx as unknown as { tools: { register(d: object): void } }).tools.register(statusTool.toolDefinition)

  ctx.effect(() => () => {
    collector.flushSync()
    feedback.disposeAll()
    store.close()
  })
}
