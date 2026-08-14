import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
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
`;
export class DeepJitStore {
    db;
    constructor(dbPath) {
        if (dbPath !== ':memory:') {
            mkdirSync(path.dirname(dbPath), { recursive: true });
        }
        this.db = new DatabaseSync(dbPath);
        this.db.exec('PRAGMA journal_mode=WAL');
        this.db.exec('PRAGMA busy_timeout=5000');
        this.migrate();
    }
    migrate() {
        const version = this.db.prepare('PRAGMA user_version').get().user_version;
        if (version >= 3)
            return;
        this.db.exec('BEGIN');
        try {
            this.db.exec(SCHEMA_V1);
            if (version === 1) {
                this.db.exec('ALTER TABLE artifacts ADD COLUMN use_count INTEGER DEFAULT 0');
                this.db.exec('ALTER TABLE artifacts ADD COLUMN last_used_ms INTEGER');
            }
            if (version <= 2) {
                this.db.exec('ALTER TABLE artifacts ADD COLUMN success_count INTEGER DEFAULT 0');
            }
            this.db.exec('PRAGMA user_version=3');
            this.db.exec('COMMIT');
        }
        catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    }
    upsertSession(sessionId, startedMs, cwd) {
        this.db
            .prepare(`INSERT INTO sessions (id, cwd, started_ms)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET cwd = COALESCE(excluded.cwd, sessions.cwd)`)
            .run(sessionId, cwd ?? null, startedMs);
    }
    touchSession(sessionId, endedMs) {
        this.db
            .prepare('UPDATE sessions SET ended_ms = ? WHERE id = ?')
            .run(endedMs, sessionId);
    }
    setSessionContext(sessionId, provider, model) {
        this.db
            .prepare('UPDATE sessions SET provider = COALESCE(?, provider), model = COALESCE(?, model) WHERE id = ?')
            .run(provider ?? null, model ?? null, sessionId);
    }
    getSessionWatermark(sessionId) {
        const row = this.db
            .prepare('SELECT last_seq, last_summarized_seq FROM sessions WHERE id = ?')
            .get(sessionId);
        return row ?? { last_seq: 0, last_summarized_seq: 0 };
    }
    /** Insert a batch of traces in one transaction and advance the session watermark. */
    insertTraces(rows) {
        if (rows.length === 0)
            return;
        const stmt = this.db.prepare(`INSERT OR IGNORE INTO traces (session_id, turn, step, kind, seq, ts_ms, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`);
        this.db.exec('BEGIN');
        try {
            const lastBySession = new Map();
            for (const row of rows) {
                stmt.run(row.session_id, row.turn, row.step, row.kind, row.seq, row.ts_ms, row.payload);
                const prev = lastBySession.get(row.session_id) ?? -1;
                if (row.seq > prev)
                    lastBySession.set(row.session_id, row.seq);
            }
            const upd = this.db.prepare('UPDATE sessions SET last_seq = MAX(last_seq, ?), ended_ms = MAX(ended_ms, ?) WHERE id = ?');
            for (const [sid, seq] of lastBySession) {
                const ts = rows.filter((r) => r.session_id === sid).reduce((m, r) => Math.max(m, r.ts_ms), 0);
                upd.run(seq, ts, sid);
            }
            this.db.exec('COMMIT');
        }
        catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
    }
    /** Tool / user traces after the summarization watermark, ordered by seq. */
    readTracesSince(sessionId, fromSeq, kinds, limit) {
        const placeholders = kinds.map(() => '?').join(',');
        const sql = `SELECT session_id, turn, step, kind, seq, ts_ms, payload
         FROM traces WHERE session_id = ? AND seq > ? AND kind IN (${placeholders})
         ORDER BY seq ASC${limit !== undefined ? ' LIMIT ?' : ''}`;
        const params = [sessionId, fromSeq, ...kinds];
        if (limit !== undefined)
            params.push(limit);
        return this.db.prepare(sql).all(...params);
    }
    advanceSummarizeWatermark(sessionId, upToSeq) {
        this.db
            .prepare('UPDATE sessions SET last_summarized_seq = MAX(last_summarized_seq, ?) WHERE id = ?')
            .run(upToSeq, sessionId);
    }
    listSummarizableSessions() {
        return this.db
            .prepare('SELECT id, last_seq, last_summarized_seq FROM sessions WHERE last_seq > last_summarized_seq')
            .all();
    }
    /** Most recently observed provider/model across sessions (from request/context events). */
    latestSessionContext() {
        const row = this.db
            .prepare('SELECT provider, model FROM sessions WHERE provider IS NOT NULL OR model IS NOT NULL ORDER BY started_ms DESC LIMIT 1')
            .get();
        return { provider: row?.provider ?? undefined, model: row?.model ?? undefined };
    }
    upsertPattern(kind, key, count, sessionsSeen, sampleSession, tsMs) {
        this.db
            .prepare(`INSERT INTO patterns (kind, key, count, sessions_seen, sample_session, first_seen_ms, last_seen_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, key) DO UPDATE SET
           count = patterns.count + excluded.count,
           sessions_seen = patterns.sessions_seen + excluded.sessions_seen,
           last_seen_ms = MAX(patterns.last_seen_ms, excluded.last_seen_ms),
           sample_session = patterns.sample_session`)
            .run(kind, key, count, sessionsSeen, sampleSession, tsMs, tsMs);
    }
    getHotPatterns(kind, minCount, minSessions, limit) {
        return this.db
            .prepare(`SELECT * FROM patterns
         WHERE kind = ? AND count >= ? AND sessions_seen >= ? AND compiled = 0
         ORDER BY count DESC, last_seen_ms DESC LIMIT ?`)
            .all(kind, minCount, minSessions, limit);
    }
    markPatternCompiled(id) {
        this.db.prepare('UPDATE patterns SET compiled = 1 WHERE id = ?').run(id);
    }
    getPatternByKey(kind, key) {
        return this.db
            .prepare('SELECT * FROM patterns WHERE kind = ? AND key = ?')
            .get(kind, key);
    }
    getPatternById(id) {
        return this.db.prepare('SELECT * FROM patterns WHERE id = ?').get(id);
    }
    hasArtifact(name) {
        return !!this.db.prepare('SELECT 1 FROM artifacts WHERE name = ?').get(name);
    }
    insertArtifact(row) {
        const now = Date.now();
        this.db
            .prepare(`INSERT OR REPLACE INTO artifacts
         (type, name, title, description, file_path, source_pattern_id, status, feedback_mode, llm_provider, llm_model, summary, created_ms, updated_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(row.type, row.name, row.title ?? null, row.description ?? null, row.file_path, row.source_pattern_id ?? null, row.status ?? 'active', row.feedback_mode ?? null, row.llm_provider ?? null, row.llm_model ?? null, row.summary ?? null, row.created_ms ?? now, now);
    }
    listArtifacts(type) {
        if (type) {
            return this.db
                .prepare('SELECT * FROM artifacts WHERE type = ? ORDER BY updated_ms DESC')
                .all(type);
        }
        return this.db
            .prepare('SELECT * FROM artifacts ORDER BY updated_ms DESC')
            .all();
    }
    getArtifact(name) {
        return this.db
            .prepare('SELECT * FROM artifacts WHERE name = ?')
            .get(name);
    }
    updateArtifactStatus(name, status) {
        this.db
            .prepare('UPDATE artifacts SET status = ?, updated_ms = ? WHERE name = ?')
            .run(status, Date.now(), name);
    }
    deleteArtifact(name) {
        this.db.prepare('DELETE FROM artifacts WHERE name = ?').run(name);
    }
    /** Bump usage counters when an artifact is invoked (skill load or flow replay). */
    recordUsage(name, now = Date.now()) {
        this.db
            .prepare('UPDATE artifacts SET use_count = use_count + 1, last_used_ms = ? WHERE name = ?')
            .run(now, name);
    }
    /** Record whether an invocation succeeded (drives promotion / deoptimization). */
    recordOutcome(name, ok) {
        if (ok)
            this.db.prepare('UPDATE artifacts SET success_count = success_count + 1 WHERE name = ?').run(name);
    }
    /** Flows used enough but failing too often — candidates for deoptimization. */
    listDeoptCandidates(minUses, maxSuccessRate) {
        return this.db
            .prepare(`SELECT * FROM artifacts
         WHERE type = 'flow' AND status = 'active' AND use_count >= ?
           AND (CAST(success_count AS REAL) / use_count) <= ?`)
            .all(minUses, maxSuccessRate);
    }
    /** Skills used often and reliably — candidates for promotion to flow (tier 2). */
    listPromoteCandidates(minUses, minSuccessRate) {
        return this.db
            .prepare(`SELECT * FROM artifacts
         WHERE type = 'skill' AND status = 'active' AND use_count >= ?
           AND source_pattern_id > 0
           AND (CAST(success_count AS REAL) / use_count) >= ?`)
            .all(minUses, minSuccessRate);
    }
    /**
     * Disable active artifacts that are old enough (past the protection window)
     * and unused for longer than the stale window. Returns the disabled names.
     */
    gcStale(now, staleMs, protectMs) {
        const rows = this.db
            .prepare(`SELECT name FROM artifacts
         WHERE status = 'active'
           AND created_ms <= ?
           AND COALESCE(last_used_ms, created_ms) <= ?`)
            .all(now - protectMs, now - staleMs);
        for (const r of rows)
            this.updateArtifactStatus(r.name, 'disabled');
        return rows.map((r) => r.name);
    }
    /** Delete trace rows older than the cutoff; returns the number removed. */
    pruneTraces(olderThanMs, now = Date.now()) {
        const res = this.db.prepare('DELETE FROM traces WHERE ts_ms < ?').run(now - olderThanMs);
        return Number(res.changes);
    }
    /** Delete uncompiled patterns not seen within the retention window. */
    prunePatterns(olderThanMs, now = Date.now()) {
        const res = this.db
            .prepare('DELETE FROM patterns WHERE compiled = 0 AND last_seen_ms < ?')
            .run(now - olderThanMs);
        return Number(res.changes);
    }
    stats() {
        const one = (sql) => this.db.prepare(sql).get().n;
        return {
            traces: one('SELECT COUNT(*) AS n FROM traces'),
            sessions: one('SELECT COUNT(*) AS n FROM sessions'),
            patterns: one('SELECT COUNT(*) AS n FROM patterns'),
            artifacts: one('SELECT COUNT(*) AS n FROM artifacts'),
        };
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=store.js.map