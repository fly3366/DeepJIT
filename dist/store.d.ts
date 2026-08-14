export type TraceKind = 'user' | 'assistant' | 'tool' | 'boundary';
export interface TraceRow {
    session_id: string;
    turn: number;
    step: number | null;
    kind: TraceKind;
    seq: number;
    ts_ms: number;
    payload: string;
}
export interface PatternRow {
    id: number;
    kind: string;
    key: string;
    count: number;
    sessions_seen: number;
    compiled: number;
    sample_session: string;
    first_seen_ms: number;
    last_seen_ms: number;
}
export interface ArtifactRow {
    id: number;
    type: 'skill' | 'flow';
    name: string;
    title: string | null;
    description: string | null;
    file_path: string;
    source_pattern_id: number | null;
    status: 'active' | 'disabled';
    feedback_mode: 'filesystem' | 'runtime' | null;
    llm_provider: string | null;
    llm_model: string | null;
    summary: string | null;
    created_ms: number;
    updated_ms: number;
    use_count: number;
    last_used_ms: number | null;
}
export declare class DeepJitStore {
    private db;
    constructor(dbPath: string);
    private migrate;
    upsertSession(sessionId: string, startedMs: number, cwd?: string): void;
    touchSession(sessionId: string, endedMs: number): void;
    setSessionContext(sessionId: string, provider?: string, model?: string): void;
    getSessionWatermark(sessionId: string): {
        last_seq: number;
        last_summarized_seq: number;
    };
    /** Insert a batch of traces in one transaction and advance the session watermark. */
    insertTraces(rows: TraceRow[]): void;
    /** Tool / user traces after the summarization watermark, ordered by seq. */
    readTracesSince(sessionId: string, fromSeq: number, kinds: TraceKind[]): TraceRow[];
    advanceSummarizeWatermark(sessionId: string, upToSeq: number): void;
    listSummarizableSessions(): {
        id: string;
        last_seq: number;
        last_summarized_seq: number;
    }[];
    /** Most recently observed provider/model across sessions (from request/context events). */
    latestSessionContext(): {
        provider?: string;
        model?: string;
    };
    upsertPattern(kind: string, key: string, count: number, sessionsSeen: number, sampleSession: string, tsMs: number): void;
    getHotPatterns(kind: string, minCount: number, minSessions: number, limit: number): PatternRow[];
    markPatternCompiled(id: number): void;
    getPatternByKey(kind: string, key: string): PatternRow | undefined;
    hasArtifact(name: string): boolean;
    insertArtifact(row: {
        type: 'skill' | 'flow';
        name: string;
        title?: string | null;
        description?: string | null;
        file_path: string;
        source_pattern_id?: number | null;
        status?: 'active' | 'disabled';
        feedback_mode?: 'filesystem' | 'runtime' | null;
        llm_provider?: string | null;
        llm_model?: string | null;
        summary?: string | null;
        created_ms?: number;
    }): void;
    listArtifacts(type?: string): ArtifactRow[];
    getArtifact(name: string): ArtifactRow | undefined;
    updateArtifactStatus(name: string, status: 'active' | 'disabled'): void;
    deleteArtifact(name: string): void;
    /** Bump usage counters when an artifact is invoked (skill load or flow replay). */
    recordUsage(name: string, now?: number): void;
    /**
     * Disable active artifacts that are old enough (past the protection window)
     * and unused for longer than the stale window. Returns the disabled names.
     */
    gcStale(now: number, staleMs: number, protectMs: number): string[];
    stats(): {
        traces: number;
        sessions: number;
        patterns: number;
        artifacts: number;
    };
    close(): void;
}
