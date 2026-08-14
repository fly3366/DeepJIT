import { DeepJitStore, type TraceRow } from './store.ts'
import { metrics } from './metrics.ts'

interface PendingCall {
  tsMs: number
  name: string
  args: string
}

/** deepjit's own tools are excluded from traces to prevent JIT self-compilation loops. */
const JIT_TOOL_PREFIX = 'deepjit_'

function isJitTool(name: string): boolean {
  return name.startsWith(JIT_TOOL_PREFIX)
}

interface BufferRow {
  row: TraceRow
  /** set once the raw tool value (from tools/result) is attached */
  patched?: boolean
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + `\n…[truncated ${text.length - maxChars} chars]`
}

function stringify(value: unknown, maxChars: number): string {
  if (value === undefined || value === null) return ''
  try {
    return truncate(JSON.stringify(value), maxChars)
  } catch {
    return truncate(String(value), maxChars)
  }
}

function textOfMessage(message: unknown, maxChars: number): string {
  // Message or { content: ContentBlock[] }; text blocks may be nested inside
  // tool-result blocks, so collect recursively.
  const content = Array.isArray(message) ? message : (message as { content?: unknown })?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  const walk = (blocks: unknown[]) => {
    for (const block of blocks) {
      const b = block as { type?: string; text?: string; content?: unknown }
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
      if (Array.isArray(b.content)) walk(b.content)
    }
  }
  walk(content)
  return truncate(parts.join('\n'), maxChars)
}

/**
 * Subscribes to session/event + tools/result, buffers compact trace rows in
 * memory and flushes them to SQLite in batches.
 */
export class TraceCollector {
  private buffer: BufferRow[] = []
  private pendingCalls = new Map<string, PendingCall>()
  private rawValues = new Map<string, string>()
  private rowsByCallId = new Map<string, BufferRow>()
  private seenSessions = new Set<string>()
  private maxResultChars: number
  private flushBatchSize: number
  private maxPendingCalls: number
  private store: DeepJitStore
  private flush: () => void

  constructor(
    store: DeepJitStore,
    flush: () => void,
    maxResultChars: number,
    flushBatchSize: number,
    maxPendingCalls = 10_000,
  ) {
    this.store = store
    this.flush = flush
    this.maxResultChars = maxResultChars
    this.flushBatchSize = flushBatchSize
    this.maxPendingCalls = maxPendingCalls
  }

  /** Diagnostic: number of tool calls awaiting a result (bounded by maxPendingCalls). */
  get pendingCount(): number {
    return this.pendingCalls.size
  }

  /** Evict oldest entries so a map never grows past the configured cap. */
  private capMap<K, V>(map: Map<K, V>): void {
    while (map.size > this.maxPendingCalls) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }

  /** ctx.on('session/event') handler; event envelope: {type, seq, time, data, ...} */
  handleEvent(sessionId: unknown, event: unknown): void {
    const env = event as { type?: string; seq?: number; time?: number; data?: unknown }
    if (!env.type || typeof env.seq !== 'number' || typeof env.time !== 'number') return
    const sid = String(sessionId)
    const { type, seq, time } = env

    if (!this.seenSessions.has(sid)) {
      this.seenSessions.add(sid)
      if (this.seenSessions.size > this.maxPendingCalls) {
        const oldest = this.seenSessions.keys().next().value
        if (oldest !== undefined) this.seenSessions.delete(oldest)
      }
      this.store.upsertSession(sid, time)
    }

    switch (type) {
      case 'user/message': {
        const text = textOfMessage(env.data, this.maxResultChars)
        if (text) this.push({ session_id: sid, turn: 0, step: null, kind: 'user', seq, ts_ms: time, payload: JSON.stringify({ text }) })
        break
      }
      case 'assistant/message': {
        const data = env.data as { turn?: number; step?: number; message?: unknown; usage?: unknown }
        const text = textOfMessage(data?.message, this.maxResultChars)
        if (!text) break
        this.push({
          session_id: sid,
          turn: Number(data?.turn ?? 0),
          step: data?.step != null ? Number(data.step) : null,
          kind: 'assistant',
          seq,
          ts_ms: time,
          payload: JSON.stringify({ text, usage: data?.usage ?? undefined }),
        })
        break
      }
      case 'tool/call': {
        const data = env.data as { callId?: string; name?: string; arguments?: string; turn?: number; step?: number }
        if (!data.callId) break
        this.recordArtifactUsage(data.name, data.arguments)
        if (data.name && isJitTool(data.name)) break
        this.pendingCalls.set(data.callId, {
          tsMs: time,
          name: String(data.name ?? ''),
          args: truncate(String(data.arguments ?? ''), this.maxResultChars),
        })
        this.capMap(this.pendingCalls)
        break
      }
      case 'tool/result': {
        const data = env.data as {
          callId?: string
          turn?: number
          step?: number
          message?: { source?: { callId?: string }; content?: unknown }
          error?: unknown
        }
        const callId = data.callId ?? data.message?.source?.callId
        if (!callId) break
        const call = this.pendingCalls.get(callId)
        this.pendingCalls.delete(callId)
        if (!call || isJitTool(call.name)) break
        const text = textOfMessage(data.message, this.maxResultChars)
        const raw = this.rawValues.get(callId)
        this.rawValues.delete(callId)
        const payload: Record<string, unknown> = {
          name: call?.name ?? '',
          callId,
          args: call?.args ?? '',
          result_ok: !data.error,
          result_text: text,
          tool_ms: call ? Math.max(0, time - call.tsMs) : 0,
        }
        if (raw) payload.raw_value = raw
        const row: TraceRow = {
          session_id: sid,
          turn: Number(data?.turn ?? 0),
          step: data?.step != null ? Number(data.step) : null,
          kind: 'tool',
          seq,
          ts_ms: time,
          payload: JSON.stringify(payload),
        }
        const entry = this.push(row)
        this.rowsByCallId.set(callId, entry)
        break
      }
      case 'turn/start':
      case 'turn/end':
      case 'step/start':
      case 'step/end': {
        const data = env.data as { turn?: number; step?: number; reason?: unknown }
        this.push({
          session_id: sid,
          turn: Number(data?.turn ?? 0),
          step: data?.step != null ? Number(data.step) : null,
          kind: 'boundary',
          seq,
          ts_ms: time,
          payload: JSON.stringify({ boundary: type, reason: data?.reason ?? null }),
        })
        break
      }
      case 'request/context': {
        const data = env.data as { provider?: string; model?: string }
        this.store.setSessionContext(sid, data?.provider, data?.model)
        break
      }
      default:
        break
    }
  }

  /** ctx.on('tools/result') handler; captures the raw frozen value for a call. */
  handleToolResult(exec: unknown, result: unknown): void {
    const e = exec as { callId?: string }
    const r = result as { isError?: boolean; value?: unknown }
    if (!e.callId) return
    const value = stringify(r?.value, this.maxResultChars)
    const entry = this.rowsByCallId.get(e.callId)
    if (entry) {
      // Row already buffered; patch the raw value in place.
      try {
        const payload = JSON.parse(entry.row.payload) as Record<string, unknown>
        if (!payload.raw_value) {
          payload.raw_value = value
          payload.result_ok = entry.row.kind === 'tool' ? !r?.isError : payload.result_ok
          entry.row.payload = JSON.stringify(payload)
          entry.patched = true
        }
      } catch {
        // keep the row as-is
      }
    } else {
      this.rawValues.set(e.callId, value)
      this.capMap(this.rawValues)
    }
  }

  /** Track invocation of compiled artifacts (separate from mining) for GC. */
  private recordArtifactUsage(name: string | undefined, argsJson: string | undefined): void {
    if (!name) return
    try {
      if (name === 'deepjit_flow') {
        const flow = (JSON.parse(argsJson ?? '{}') as { flow?: unknown }).flow
        if (typeof flow === 'string' && flow) this.store.recordUsage(flow)
      } else if (name === 'skill') {
        const skill = (JSON.parse(argsJson ?? '{}') as { name?: unknown }).name
        if (typeof skill === 'string' && skill.startsWith('deepjit-')) this.store.recordUsage(skill)
      }
    } catch {
      // usage tracking is best-effort
    }
  }

  private push(row: TraceRow): BufferRow {
    const entry = { row }
    this.buffer.push(entry)
    if (this.buffer.length >= this.flushBatchSize) this.flush()
    return entry
  }

  /** Flush buffered rows to the store. */
  flushSync(): void {
    if (this.buffer.length === 0) return
    const rows = this.buffer.map((b) => b.row)
    this.buffer = []
    this.rowsByCallId.clear()
    this.rawValues.clear()
    this.store.insertTraces(rows)
    metrics.inc('flushes')
    metrics.inc('traces_flushed', rows.length)
  }
}
