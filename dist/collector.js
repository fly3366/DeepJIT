/** deepjit's own tools are excluded from traces to prevent JIT self-compilation loops. */
const JIT_TOOL_PREFIX = 'deepjit_';
function isJitTool(name) {
    return name.startsWith(JIT_TOOL_PREFIX);
}
function truncate(text, maxChars) {
    if (text.length <= maxChars)
        return text;
    return text.slice(0, maxChars) + `\n…[truncated ${text.length - maxChars} chars]`;
}
function stringify(value, maxChars) {
    if (value === undefined || value === null)
        return '';
    try {
        return truncate(JSON.stringify(value), maxChars);
    }
    catch {
        return truncate(String(value), maxChars);
    }
}
function textOfMessage(message, maxChars) {
    // Message or { content: ContentBlock[] }; text blocks may be nested inside
    // tool-result blocks, so collect recursively.
    const content = Array.isArray(message) ? message : message?.content;
    if (!Array.isArray(content))
        return '';
    const parts = [];
    const walk = (blocks) => {
        for (const block of blocks) {
            const b = block;
            if (b.type === 'text' && typeof b.text === 'string')
                parts.push(b.text);
            if (Array.isArray(b.content))
                walk(b.content);
        }
    };
    walk(content);
    return truncate(parts.join('\n'), maxChars);
}
/**
 * Subscribes to session/event + tools/result, buffers compact trace rows in
 * memory and flushes them to SQLite in batches.
 */
export class TraceCollector {
    buffer = [];
    pendingCalls = new Map();
    rawValues = new Map();
    rowsByCallId = new Map();
    seenSessions = new Set();
    maxResultChars;
    flushBatchSize;
    maxPendingCalls;
    store;
    flush;
    constructor(store, flush, maxResultChars, flushBatchSize, maxPendingCalls = 10_000) {
        this.store = store;
        this.flush = flush;
        this.maxResultChars = maxResultChars;
        this.flushBatchSize = flushBatchSize;
        this.maxPendingCalls = maxPendingCalls;
    }
    /** Diagnostic: number of tool calls awaiting a result (bounded by maxPendingCalls). */
    get pendingCount() {
        return this.pendingCalls.size;
    }
    /** Evict oldest entries so a map never grows past the configured cap. */
    capMap(map) {
        while (map.size > this.maxPendingCalls) {
            const oldest = map.keys().next().value;
            if (oldest === undefined)
                break;
            map.delete(oldest);
        }
    }
    /** ctx.on('session/event') handler; event envelope: {type, seq, time, data, ...} */
    handleEvent(sessionId, event) {
        const env = event;
        if (!env.type || typeof env.seq !== 'number' || typeof env.time !== 'number')
            return;
        const sid = String(sessionId);
        const { type, seq, time } = env;
        if (!this.seenSessions.has(sid)) {
            this.seenSessions.add(sid);
            if (this.seenSessions.size > this.maxPendingCalls) {
                const oldest = this.seenSessions.keys().next().value;
                if (oldest !== undefined)
                    this.seenSessions.delete(oldest);
            }
            this.store.upsertSession(sid, time);
        }
        switch (type) {
            case 'user/message': {
                const text = textOfMessage(env.data, this.maxResultChars);
                if (text)
                    this.push({ session_id: sid, turn: 0, step: null, kind: 'user', seq, ts_ms: time, payload: JSON.stringify({ text }) });
                break;
            }
            case 'assistant/message': {
                const data = env.data;
                const text = textOfMessage(data?.message, this.maxResultChars);
                if (!text)
                    break;
                this.push({
                    session_id: sid,
                    turn: Number(data?.turn ?? 0),
                    step: data?.step != null ? Number(data.step) : null,
                    kind: 'assistant',
                    seq,
                    ts_ms: time,
                    payload: JSON.stringify({ text, usage: data?.usage ?? undefined }),
                });
                break;
            }
            case 'tool/call': {
                const data = env.data;
                if (!data.callId)
                    break;
                this.recordArtifactUsage(data.name, data.arguments);
                if (data.name && isJitTool(data.name))
                    break;
                this.pendingCalls.set(data.callId, {
                    tsMs: time,
                    name: String(data.name ?? ''),
                    args: truncate(String(data.arguments ?? ''), this.maxResultChars),
                });
                this.capMap(this.pendingCalls);
                break;
            }
            case 'tool/result': {
                const data = env.data;
                const callId = data.callId ?? data.message?.source?.callId;
                if (!callId)
                    break;
                const call = this.pendingCalls.get(callId);
                this.pendingCalls.delete(callId);
                if (!call || isJitTool(call.name))
                    break;
                const text = textOfMessage(data.message, this.maxResultChars);
                const raw = this.rawValues.get(callId);
                this.rawValues.delete(callId);
                const payload = {
                    name: call?.name ?? '',
                    callId,
                    args: call?.args ?? '',
                    result_ok: !data.error,
                    result_text: text,
                    tool_ms: call ? Math.max(0, time - call.tsMs) : 0,
                };
                if (raw)
                    payload.raw_value = raw;
                const row = {
                    session_id: sid,
                    turn: Number(data?.turn ?? 0),
                    step: data?.step != null ? Number(data.step) : null,
                    kind: 'tool',
                    seq,
                    ts_ms: time,
                    payload: JSON.stringify(payload),
                };
                const entry = this.push(row);
                this.rowsByCallId.set(callId, entry);
                break;
            }
            case 'turn/start':
            case 'turn/end':
            case 'step/start':
            case 'step/end': {
                const data = env.data;
                this.push({
                    session_id: sid,
                    turn: Number(data?.turn ?? 0),
                    step: data?.step != null ? Number(data.step) : null,
                    kind: 'boundary',
                    seq,
                    ts_ms: time,
                    payload: JSON.stringify({ boundary: type, reason: data?.reason ?? null }),
                });
                break;
            }
            case 'request/context': {
                const data = env.data;
                this.store.setSessionContext(sid, data?.provider, data?.model);
                break;
            }
            default:
                break;
        }
    }
    /** ctx.on('tools/result') handler; captures the raw frozen value for a call. */
    handleToolResult(exec, result) {
        const e = exec;
        const r = result;
        if (!e.callId)
            return;
        const value = stringify(r?.value, this.maxResultChars);
        const entry = this.rowsByCallId.get(e.callId);
        if (entry) {
            // Row already buffered; patch the raw value in place.
            try {
                const payload = JSON.parse(entry.row.payload);
                if (!payload.raw_value) {
                    payload.raw_value = value;
                    payload.result_ok = entry.row.kind === 'tool' ? !r?.isError : payload.result_ok;
                    entry.row.payload = JSON.stringify(payload);
                    entry.patched = true;
                }
            }
            catch {
                // keep the row as-is
            }
        }
        else {
            this.rawValues.set(e.callId, value);
            this.capMap(this.rawValues);
        }
    }
    /** Track invocation of compiled artifacts (separate from mining) for GC. */
    recordArtifactUsage(name, argsJson) {
        if (!name)
            return;
        try {
            if (name === 'deepjit_flow') {
                const flow = JSON.parse(argsJson ?? '{}').flow;
                if (typeof flow === 'string' && flow)
                    this.store.recordUsage(flow);
            }
            else if (name === 'skill') {
                const skill = JSON.parse(argsJson ?? '{}').name;
                if (typeof skill === 'string' && skill.startsWith('deepjit-'))
                    this.store.recordUsage(skill);
            }
        }
        catch {
            // usage tracking is best-effort
        }
    }
    push(row) {
        const entry = { row };
        this.buffer.push(entry);
        if (this.buffer.length >= this.flushBatchSize)
            this.flush();
        return entry;
    }
    /** Flush buffered rows to the store. */
    flushSync() {
        if (this.buffer.length === 0)
            return;
        const rows = this.buffer.map((b) => b.row);
        this.buffer = [];
        this.rowsByCallId.clear();
        this.rawValues.clear();
        this.store.insertTraces(rows);
    }
}
//# sourceMappingURL=collector.js.map