const STOPWORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in', 'on',
    'for', 'and', 'or', 'with', 'at', 'by', 'from', 'as', 'it', 'its', 'this', 'that',
    'these', 'those', 'please', 'can', 'could', 'would', 'should', 'do', 'does', 'did',
    'i', 'you', 'we', 'they', 'he', 'she', 'me', 'my', 'your', 'our', 'their',
    'help', 'want', 'need', 'make', 'use', 'using', 'get', 'give', 'tell',
]);
/** Extract intent keywords: ASCII words + CJK bigrams, stopword filtered. */
export function extractKeywords(text, maxPerText = 12) {
    const out = [];
    const push = (tok) => {
        const lower = tok.toLowerCase();
        if (lower.length >= 2 && !STOPWORDS.has(lower))
            out.push(lower);
    };
    for (const word of text.split(/[^\p{L}\p{N}]+/u)) {
        if (/^[\x00-\x7F]+$/.test(word))
            push(word);
    }
    for (const pair of text.match(/[\u4e00-\u9fff]{2}/g) ?? [])
        push(pair);
    return out.slice(0, maxPerText);
}
/**
 * Incremental hot-path mining: per-session tool-sequence n-grams and intent
 * keywords, aggregated across sessions into the patterns table.
 */
export function mineHotPatterns(store, cfg) {
    const now = Date.now();
    for (const session of store.listSummarizableSessions()) {
        const fromSeq = session.last_summarized_seq;
        const toolRows = store.readTracesSince(session.id, fromSeq, ['tool']);
        const userRows = store.readTracesSince(session.id, fromSeq, ['user']);
        const names = toolRows
            .map((r) => {
            try {
                return JSON.parse(r.payload).name ?? '';
            }
            catch {
                return '';
            }
        })
            .filter((name) => name && !name.startsWith('deepjit_'));
        // n-gram counting for this session
        const local = new Map();
        for (let n = cfg.ngramMin; n <= cfg.ngramMax; n++) {
            for (let i = 0; i + n <= names.length; i++) {
                const key = names.slice(i, i + n).join('>');
                local.set(key, (local.get(key) ?? 0) + 1);
            }
        }
        for (const [key, count] of local) {
            store.upsertPattern('flow-seq', key, count, 1, session.id, now);
        }
        // intent keywords
        const kw = new Map();
        for (const row of userRows) {
            try {
                const text = JSON.parse(row.payload).text ?? '';
                for (const token of extractKeywords(text))
                    kw.set(token, (kw.get(token) ?? 0) + 1);
            }
            catch {
                // skip malformed payloads
            }
        }
        for (const [key, count] of kw) {
            store.upsertPattern('intent', key, count, 1, session.id, now);
        }
        store.advanceSummarizeWatermark(session.id, session.last_seq);
    }
}
//# sourceMappingURL=miner.js.map