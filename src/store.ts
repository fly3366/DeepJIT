import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

export type TraceKind = 'user' | 'assistant' | 'tool' | 'boundary'

export interface TraceRow {
  session_id: string
  turn: number
  step: number | null
  kind: TraceKind
  seq: number
  ts_ms: number
  payload: string
}

export interface PatternRow {
  id: number
  kind: string
  key: string
  count: number
  sessions_seen: number
  compiled: number
  sample_session: string
  first_seen_ms: number
  last_seen_ms: number
}

export interface ArtifactRow {
  id: number
  type: 'skill' | 'flow'
  name: string
  title: string | null
  description: string | null
  file_path: string
  source_pattern_id: number | null
  status: 'active' | 'disabled'
  feedback_mode: 'filesystem' | 'runtime' | null
  llm_provider: string | null
  llm_model: string | null
  summary: string | null
  created_ms: number
  updated_ms: number
  use_count: number
  last_used_ms: number | null
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT,
  provider TEXT,
  model TEXT,
  started_ms INTEGER,
  ended_ms INTEGER,
  last_seq INTEGER DEFAULT 0,
  last_summarized_seq INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS traces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn INTEGER NOT NULL,
  step INTEGER,
  kind TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts_ms INTEGER NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_traces_session ON traces(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_traces_kind ON traces(kind);
CREATE TABLE IF NOT EXISTS patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL,
  sessions_seen INTEGER DEFAULT 0,
  compiled INTEGER DEFAULT 0,
  sample_session TEXT NOT NULL,
  first_seen_ms INTEGER,
  last_seen_ms INTEGER,
  UNIQUE(kind, key)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  title TEXT,
  description TEXT,
  file_path TEXT NOT NULL,
  source_pattern_id INTEGER,
  status TEXT DEFAULT 'active',
  feedback_mode TEXT,
  llm_provider TEXT,
  llm_model TEXT,
  summary TEXT,
  created_ms INTEGER,
  updated_ms INTEGER,
  use_count INTEGER DEFAULT 0,
  last_used_ms INTEGER
);
`

export class DeepJitStore {
  private db: DatabaseSync

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(dbPath), { recursive: true })
    }
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA busy_timeout=5000')
    this.migrate()
  }

  private migrate(): void {
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (version >= 2) return
    this.db.exec('BEGIN')
    try {
      this.db.exec(SCHEMA_V1)
      if (version === 1) {
        this.db.exec('ALTER TABLE artifacts ADD COLUMN use_count INTEGER DEFAULT 0')
        this.db.exec('ALTER TABLE artifacts ADD COLUMN last_used_ms INTEGER')
      }
      this.db.exec('PRAGMA user_version=2')
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  upsertSession(sessionId: string, startedMs: number, cwd?: string): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, cwd, started_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cwd = COALESCE(excluded.cwd, sessions.cwd)`,
      )
      .run(sessionId, cwd ?? null, startedMs)
  }

  touchSession(sessionId: string, endedMs: number): void {
    this.db
      .prepare('UPDATE sessions SET ended_ms = ? WHERE id = ?')
      .run(endedMs, sessionId)
  }

  setSessionContext(sessionId: string, provider?: string, model?: string): void {
    this.db
      .prepare(
        'UPDATE sessions SET provider = COALESCE(?, provider), model = COALESCE(?, model) WHERE id = ?',
      )
      .run(provider ?? null, model ?? null, sessionId)
  }

  getSessionWatermark(sessionId: string): { last_seq: number; last_summarized_seq: number } {
    const row = this.db
      .prepare('SELECT last_seq, last_summarized_seq FROM sessions WHERE id = ?')
      .get(sessionId) as { last_seq: number; last_summarized_seq: number } | undefined
    return row ?? { last_seq: 0, last_summarized_seq: 0 }
  }

  /** Insert a batch of traces in one transaction and advance the session watermark. */
  insertTraces(rows: TraceRow[]): void {
    if (rows.length === 0) return
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO traces (session_id, turn, step, kind, seq, ts_ms, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    this.db.exec('BEGIN')
    try {
      const lastBySession = new Map<string, number>()
      for (const row of rows) {
        stmt.run(row.session_id, row.turn, row.step, row.kind, row.seq, row.ts_ms, row.payload)
        const prev = lastBySession.get(row.session_id) ?? -1
        if (row.seq > prev) lastBySession.set(row.session_id, row.seq)
      }
      const upd = this.db.prepare(
        'UPDATE sessions SET last_seq = MAX(last_seq, ?), ended_ms = MAX(ended_ms, ?) WHERE id = ?',
      )
      for (const [sid, seq] of lastBySession) {
        const ts = rows.filter((r) => r.session_id === sid).reduce((m, r) => Math.max(m, r.ts_ms), 0)
        upd.run(seq, ts, sid)
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** Tool / user traces after the summarization watermark, ordered by seq. */
  readTracesSince(sessionId: string, fromSeq: number, kinds: TraceKind[]): TraceRow[] {
    const placeholders = kinds.map(() => '?').join(',')
    return this.db
      .prepare(
        `SELECT session_id, turn, step, kind, seq, ts_ms, payload
         FROM traces WHERE session_id = ? AND seq > ? AND kind IN (${placeholders})
         ORDER BY seq ASC`,
      )
      .all(sessionId, fromSeq, ...kinds) as unknown as TraceRow[]
  }

  advanceSummarizeWatermark(sessionId: string, upToSeq: number): void {
    this.db
      .prepare('UPDATE sessions SET last_summarized_seq = MAX(last_summarized_seq, ?) WHERE id = ?')
      .run(upToSeq, sessionId)
  }

  listSummarizableSessions(): { id: string; last_seq: number; last_summarized_seq: number }[] {
    return this.db
      .prepare(
        'SELECT id, last_seq, last_summarized_seq FROM sessions WHERE last_seq > last_summarized_seq',
      )
      .all() as unknown as { id: string; last_seq: number; last_summarized_seq: number }[]
  }

  /** Most recently observed provider/model across sessions (from request/context events). */
  latestSessionContext(): { provider?: string; model?: string } {
    const row = this.db
      .prepare(
        'SELECT provider, model FROM sessions WHERE provider IS NOT NULL OR model IS NOT NULL ORDER BY started_ms DESC LIMIT 1',
      )
      .get() as { provider: string | null; model: string | null } | undefined
    return { provider: row?.provider ?? undefined, model: row?.model ?? undefined }
  }

  upsertPattern(
    kind: string,
    key: string,
    count: number,
    sessionsSeen: number,
    sampleSession: string,
    tsMs: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO patterns (kind, key, count, sessions_seen, sample_session, first_seen_ms, last_seen_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, key) DO UPDATE SET
           count = patterns.count + excluded.count,
           sessions_seen = patterns.sessions_seen + excluded.sessions_seen,
           last_seen_ms = MAX(patterns.last_seen_ms, excluded.last_seen_ms),
           sample_session = patterns.sample_session`,
      )
      .run(kind, key, count, sessionsSeen, sampleSession, tsMs, tsMs)
  }

  getHotPatterns(kind: string, minCount: number, minSessions: number, limit: number): PatternRow[] {
    return this.db
      .prepare(
        `SELECT * FROM patterns
         WHERE kind = ? AND count >= ? AND sessions_seen >= ? AND compiled = 0
         ORDER BY count DESC, last_seen_ms DESC LIMIT ?`,
      )
      .all(kind, minCount, minSessions, limit) as unknown as PatternRow[]
  }

  markPatternCompiled(id: number): void {
    this.db.prepare('UPDATE patterns SET compiled = 1 WHERE id = ?').run(id)
  }

  getPatternByKey(kind: string, key: string): PatternRow | undefined {
    return this.db
      .prepare('SELECT * FROM patterns WHERE kind = ? AND key = ?')
      .get(kind, key) as unknown as PatternRow | undefined
  }

  hasArtifact(name: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM artifacts WHERE name = ?').get(name)
  }

  insertArtifact(row: {
    type: 'skill' | 'flow'
    name: string
    title?: string | null
    description?: string | null
    file_path: string
    source_pattern_id?: number | null
    status?: 'active' | 'disabled'
    feedback_mode?: 'filesystem' | 'runtime' | null
    llm_provider?: string | null
    llm_model?: string | null
    summary?: string | null
    created_ms?: number
  }): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT OR REPLACE INTO artifacts
         (type, name, title, description, file_path, source_pattern_id, status, feedback_mode, llm_provider, llm_model, summary, created_ms, updated_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.type,
        row.name,
        row.title ?? null,
        row.description ?? null,
        row.file_path,
        row.source_pattern_id ?? null,
        row.status ?? 'active',
        row.feedback_mode ?? null,
        row.llm_provider ?? null,
        row.llm_model ?? null,
        row.summary ?? null,
        row.created_ms ?? now,
        now,
      )
  }

  listArtifacts(type?: string): ArtifactRow[] {
    if (type) {
      return this.db
        .prepare('SELECT * FROM artifacts WHERE type = ? ORDER BY updated_ms DESC')
        .all(type) as unknown as ArtifactRow[]
    }
    return this.db
      .prepare('SELECT * FROM artifacts ORDER BY updated_ms DESC')
      .all() as unknown as ArtifactRow[]
  }

  getArtifact(name: string): ArtifactRow | undefined {
    return this.db
      .prepare('SELECT * FROM artifacts WHERE name = ?')
      .get(name) as unknown as ArtifactRow | undefined
  }

  updateArtifactStatus(name: string, status: 'active' | 'disabled'): void {
    this.db
      .prepare('UPDATE artifacts SET status = ?, updated_ms = ? WHERE name = ?')
      .run(status, Date.now(), name)
  }

  deleteArtifact(name: string): void {
    this.db.prepare('DELETE FROM artifacts WHERE name = ?').run(name)
  }

  /** Bump usage counters when an artifact is invoked (skill load or flow replay). */
  recordUsage(name: string, now = Date.now()): void {
    this.db
      .prepare('UPDATE artifacts SET use_count = use_count + 1, last_used_ms = ? WHERE name = ?')
      .run(now, name)
  }

  /**
   * Disable active artifacts that are old enough (past the protection window)
   * and unused for longer than the stale window. Returns the disabled names.
   */
  gcStale(now: number, staleMs: number, protectMs: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT name FROM artifacts
         WHERE status = 'active'
           AND created_ms <= ?
           AND COALESCE(last_used_ms, created_ms) <= ?`,
      )
      .all(now - protectMs, now - staleMs) as { name: string }[]
    for (const r of rows) this.updateArtifactStatus(r.name, 'disabled')
    return rows.map((r) => r.name)
  }

  stats(): { traces: number; sessions: number; patterns: number; artifacts: number } {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n
    return {
      traces: one('SELECT COUNT(*) AS n FROM traces'),
      sessions: one('SELECT COUNT(*) AS n FROM sessions'),
      patterns: one('SELECT COUNT(*) AS n FROM patterns'),
      artifacts: one('SELECT COUNT(*) AS n FROM artifacts'),
    }
  }

  close(): void {
    this.db.close()
  }
}
