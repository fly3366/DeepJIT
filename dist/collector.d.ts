import { DeepJitStore } from './store.ts';
/**
 * Subscribes to session/event + tools/result, buffers compact trace rows in
 * memory and flushes them to SQLite in batches.
 */
export declare class TraceCollector {
    private buffer;
    private pendingCalls;
    private rawValues;
    private rowsByCallId;
    private seenSessions;
    private maxResultChars;
    private flushBatchSize;
    private maxPendingCalls;
    private store;
    private flush;
    constructor(store: DeepJitStore, flush: () => void, maxResultChars: number, flushBatchSize: number, maxPendingCalls?: number);
    /** Diagnostic: number of tool calls awaiting a result (bounded by maxPendingCalls). */
    get pendingCount(): number;
    /** Evict oldest entries so a map never grows past the configured cap. */
    private capMap;
    /** ctx.on('session/event') handler; event envelope: {type, seq, time, data, ...} */
    handleEvent(sessionId: unknown, event: unknown): void;
    /** ctx.on('tools/result') handler; captures the raw frozen value for a call. */
    handleToolResult(exec: unknown, result: unknown): void;
    /** Track invocation of compiled artifacts (separate from mining) for GC. */
    private recordArtifactUsage;
    private push;
    /** Flush buffered rows to the store. */
    flushSync(): void;
}
