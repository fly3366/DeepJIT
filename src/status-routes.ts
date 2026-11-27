/**
 * Web UI data channel: an exact Connection Fetch route exposing read-only
 * DeepJIT status as JSON to the plugin's own browser half (web/client.js).
 *
 * Uses the lightest dsh channel — a Host-registered exact Fetch route — rather
 * than Typert codegen. The browser calls it document-relative (`api/deepjit/status`);
 * auth is the framework's same-origin owner-peer cookie. `connection` is
 * web-profile-only, so index.ts registers this through a nested
 * `ctx.inject(['connection'], ...)` and headless behavior is unchanged.
 *
 * The payload deliberately excludes host filesystem paths and session ids:
 * `file_path` becomes a boolean `fileOk`, and `sample_session` is dropped.
 */
import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { DeepJitStore, qualityScore } from './store.ts'
import { metrics } from './metrics.ts'
import type { StatusTool } from './status-tool.ts'

export const STATUS_PATH = '/api/deepjit/status'
export const ACTION_PATH = '/api/deepjit/action'

const ACTION_ALLOWLIST = ['enable', 'disable', 'delete'] as const
export type ActionName = (typeof ACTION_ALLOWLIST)[number]

const MAX_NAME_LEN = 200
const MAX_BODY_BYTES = 64 * 1024

/**
 * Defense-in-depth against path traversal in feedback's path.join: artifact
 * names are lowercase kebab (as the compiler enforces). Rejects separators,
 * dot-segments and leading dots on top of the getArtifact existence gate.
 */
export function isValidArtifactName(name: unknown): name is string {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= MAX_NAME_LEN
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
}

export interface ArtifactView {
  name: string
  type: 'skill' | 'flow'
  title: string | null
  description: string | null
  status: 'active' | 'disabled'
  quality: number
  use_count: number
  success_count: number
  created_ms: number
  updated_ms: number
  last_used_ms: number | null
  fileOk: boolean
}

export interface PatternView {
  kind: string
  key: string
  count: number
  sessions_seen: number
  last_seen_ms: number
}

export interface StatusPayload {
  artifacts: ArtifactView[]
  patterns: PatternView[]
  stats: { traces: number; sessions: number; patterns: number; artifacts: number }
  metrics: Record<string, number>
}

/** Pure payload builder — reused by the route and unit-testable without a Request. */
export function buildStatusPayload(store: DeepJitStore): StatusPayload {
  const artifacts: ArtifactView[] = store.listArtifacts().map((r) => ({
    name: r.name,
    type: r.type,
    title: r.title,
    description: r.description,
    status: r.status,
    quality: qualityScore(r.use_count, r.success_count),
    use_count: r.use_count,
    success_count: r.success_count,
    created_ms: r.created_ms,
    updated_ms: r.updated_ms,
    last_used_ms: r.last_used_ms,
    fileOk: existsSync(r.file_path),
  }))
  const patterns: PatternView[] = store.getHotPatterns('flow-seq', 2, 1, 20).map((p) => ({
    kind: p.kind,
    key: p.key,
    count: p.count,
    sessions_seen: p.sessions_seen,
    last_seen_ms: p.last_seen_ms,
  }))
  return { artifacts, patterns, stats: store.stats(), metrics: metrics.snapshot() }
}

interface ConnectionLike {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
      readonly requestBody: 'buffered'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

export interface StatusRouteDeps {
  store: DeepJitStore
  statusTool: StatusTool
  log: (msg: string) => void
}

/** Register the GET status + POST action routes on the (web-only) connection service. */
export function registerStatusRoutes(ctx: Context, deps: StatusRouteDeps): void {
  const connection = Reflect.get(ctx, 'connection') as ConnectionLike | undefined
  if (!connection) return
  const { store, statusTool, log } = deps
  connection.fetch.register({
    path: STATUS_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      try {
        request.signal.throwIfAborted()
        return Response.json(buildStatusPayload(store))
      } catch (err) {
        // Host log only; the browser gets a stable code, never err.message (host paths).
        log(`deepjit: status route error: ${(err as Error).message}`)
        return Response.json({ error: 'status-unavailable' }, { status: 500 })
      }
    },
  })
  connection.fetch.register({
    path: ACTION_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const len = Number(request.headers.get('content-length') ?? 0)
      if (len > MAX_BODY_BYTES) return Response.json({ ok: false, code: 'body-too-large' }, { status: 413 })
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return Response.json({ ok: false, code: 'invalid-body' }, { status: 400 })
      }
      const action = (body as { action?: unknown } | null)?.action
      const name = (body as { name?: unknown } | null)?.name
      if (typeof action !== 'string' || !ACTION_ALLOWLIST.includes(action as ActionName)) {
        return Response.json({ ok: false, code: 'invalid-action' }, { status: 400 })
      }
      if (!isValidArtifactName(name)) {
        return Response.json({ ok: false, code: 'invalid-name' }, { status: 400 })
      }
      try {
        const result = statusTool.applyAction(action as ActionName, name)
        return Response.json(result, { status: result.ok ? 200 : 400 })
      } catch (err) {
        log(`deepjit: action route error: ${(err as Error).message}`)
        return Response.json({ ok: false, code: 'action-failed' }, { status: 500 })
      }
    },
  })
}