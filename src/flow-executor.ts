import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DeepJitStore } from './store.ts'
import { t } from './i18n.ts'

export interface FlowStep {
  tool: string
  args: Record<string, unknown>
  onError?: 'stop' | 'continue' | 'retry'
  timeoutMs?: number
}

export interface FlowTemplate {
  name: string
  description: string
  whenToUse?: string
  steps: FlowStep[]
}

export interface StepOutcome {
  index: number
  tool: string
  ok: boolean
  error?: string
  summary?: string
}

export interface ExecuteFn {
  (input: {
    callId: unknown
    name: string
    arguments: Record<string, unknown>
    agent?: unknown
    signal: AbortSignal
  }): Promise<unknown>
}

const TEMPLATE_RE = /^\$\{input\.(.+)\}$/

function resolveValue(value: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const match = TEMPLATE_RE.exec(value)
    if (match?.[1]) return getPath(input, match[1])
    return value
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, input))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveValue(v, input)
    return out
  }
  return value
}

function getPath(obj: Record<string, unknown>, dotted: string): unknown {
  let cur: unknown = obj
  for (const part of dotted.split('.')) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[part]
    else return undefined
  }
  return cur
}

function resultSummary(result: unknown, maxChars: number): string {
  const r = result as { isError?: boolean; value?: unknown; content?: unknown; error?: { message?: string } } | undefined
  if (r?.isError) return r.error?.message ?? 'tool failed'
  const content = Array.isArray(r?.content)
    ? (r.content as { type?: string; text?: string }[]).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
    : ''
  const value = r?.value === undefined ? '' : JSON.stringify(r.value)
  const text = (content || value || '').trim()
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '…'
}

/** The deepjit_flow tool: replays a compiled flow template with new inputs. */
export class FlowExecutor {
  private flowDir: string
  private store: DeepJitStore
  private execute: ExecuteFn
  private makeCallId: (uuid: string) => unknown
  private stepTimeoutMs: number
  private maxResultChars: number
  private log: (msg: string) => void

  constructor(
    flowDir: string,
    store: DeepJitStore,
    execute: ExecuteFn,
    makeCallId: (uuid: string) => unknown,
    stepTimeoutMs: number,
    maxResultChars: number,
    log: (msg: string) => void,
  ) {
    this.flowDir = flowDir
    this.store = store
    this.execute = execute
    this.makeCallId = makeCallId
    this.stepTimeoutMs = stepTimeoutMs
    this.maxResultChars = maxResultChars
    this.log = log
  }

  get toolDefinition(): object {
    return {
      name: 'deepjit_flow',
      description:
        'Execute a JIT-compiled flow template with new arguments. The template was compiled by deepjit from ' +
        'recurring tool workflows. Each step runs through the normal permission system.',
      parameters: {
        type: 'object',
        properties: {
          flow: { type: 'string', description: 'Flow name, e.g. "deepjit-summarize-repo"' },
          args: { type: 'object', description: 'Input values referenced by the flow as ${input.<key>}' },
        },
        required: ['flow'],
      },
      output: {
        schema: { type: 'string' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
      },
      execute: async (args: { flow: string; args?: Record<string, unknown> }, exec: { agent?: unknown; signal: AbortSignal }) => {
        return this.run(args.flow, args.args ?? {}, exec.agent, exec.signal)
      },
    }
  }

  static readonly MAX_DEPTH = 3

  async run(
    flowName: string,
    input: Record<string, unknown>,
    agent: unknown,
    signal: AbortSignal,
    depth = 0,
  ): Promise<{ ok: boolean; steps: StepOutcome[] }> {
    const artifact = this.store.getArtifact(flowName)
    if (!artifact || artifact.type !== 'flow') {
      throw new Error(t('flow.unknown', { name: flowName }))
    }
    if (artifact.status === 'disabled') throw new Error(t('flow.disabled', { name: flowName }))
    const template = JSON.parse(readFileSync(path.join(this.flowDir, `${flowName}.json`), 'utf8')) as FlowTemplate
    if (!Array.isArray(template.steps) || template.steps.length === 0) {
      throw new Error(t('flow.noSteps', { name: flowName }))
    }
    if (template.steps.some((s) => s.tool === 'deepjit_status')) {
      throw new Error(t('flow.recursive', { name: flowName }))
    }

    const outcomes: StepOutcome[] = []
    for (let i = 0; i < template.steps.length; i++) {
      if (signal.aborted) break
      const step = template.steps[i]!
      const resolvedArgs = resolveValue(step.args ?? {}, input) as Record<string, unknown>

      // Nested flow: recurse with the step's args as the child input, depth-limited.
      if (step.tool === 'deepjit_flow') {
        if (depth + 1 > FlowExecutor.MAX_DEPTH) {
          outcomes.push({ index: i + 1, tool: step.tool, ok: false, error: t('flow.recursive', { name: flowName }) })
          break
        }
        const nestedFlow = String(resolvedArgs.flow ?? '')
        const nestedInput = (resolvedArgs.args ?? {}) as Record<string, unknown>
        try {
          const nested = await this.run(nestedFlow, nestedInput, agent, signal, depth + 1)
          outcomes.push({ index: i + 1, tool: `${step.tool}:${nestedFlow}`, ok: nested.ok, summary: `${nested.steps.length} nested steps` })
          if (!nested.ok && step.onError === 'stop') break
        } catch (err) {
          outcomes.push({ index: i + 1, tool: `${step.tool}:${nestedFlow}`, ok: false, error: (err as Error).message })
          if (step.onError === 'stop') break
        }
        continue
      }

      const timeoutMs = step.timeoutMs ?? this.stepTimeoutMs
      let attempts = step.onError === 'retry' ? 2 : 0
      let result: unknown
      let lastError: string | undefined
      for (let attempt = 0; attempt <= attempts; attempt++) {
        if (signal.aborted) break
        try {
          result = await this.execute({
            callId: this.makeCallId(crypto.randomUUID()),
            name: step.tool,
            arguments: resolvedArgs,
            agent,
            signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
          })
          const r = result as { isError?: boolean; error?: { message?: string } }
          if (r?.isError) {
            lastError = r.error?.message ?? `step failed (${step.tool})`
            if (attempt < attempts) {
              this.log(`deepjit: flow ${flowName} step ${i + 1} failed, retrying (${attempt + 1}/2)`)
              continue
            }
          } else {
            lastError = undefined
          }
          break
        } catch (err) {
          lastError = (err as Error).message
          if (attempt < attempts) continue
          break
        }
      }
      const ok = !lastError
      outcomes.push({
        index: i + 1,
        tool: step.tool,
        ok,
        error: lastError,
        summary: ok ? resultSummary(result, this.maxResultChars) : undefined,
      })
      if (!ok && step.onError === 'stop') break
      if (!ok && step.onError !== 'continue' && step.onError !== 'retry') break
    }
    const ok = outcomes.every((o) => o.ok) && !signal.aborted
    this.store.recordOutcome(flowName, ok)
    return { ok, steps: outcomes }
  }
}
