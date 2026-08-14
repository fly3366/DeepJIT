import { readFileSync, existsSync } from 'node:fs';
/** Prefix applied to every published artifact name. */
export const SKILL_PREFIX = 'deepjit-';
/** Number of tool steps encoded in a flow-seq pattern key ("a>b>c" => 3). */
export function patternSteps(key) {
    return key.split('>').length;
}
/**
 * Heuristic worth of compiling a pattern: repetition x length. A single tool
 * repeated often, or a long flow seen rarely, both score low; only flows that
 * are both repeated AND multi-step justify an LLM compile.
 */
export function patternValue(count, key) {
    return count * patternSteps(key);
}
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SYSTEM_PROMPT = [
    'You are the JIT compiler of an agent harness. Recurring tool workflows must be compiled into',
    'reusable assets: either a "skill" (a markdown instruction guide the agent loads on demand) or a',
    '"flow" (a strict JSON step template replayed by a flow executor with new inputs).',
    'Rules:',
    '- Output ONLY a single JSON object, no prose, no code fences.',
    '- "type" is "skill" when the flow is procedural/heuristic (instructions matter more than calls);',
    '  "flow" when it is a deterministic sequence of tool calls with clear argument mapping.',
    '- "name" must match ^[a-z0-9]+(?:-[a-z0-9]+)*$ and be descriptive.',
    '- For "flow", every "steps[].tool" must be one of the tools observed in the transcript.',
    '- "steps[].args" values are template strings like "${input.x}" (bound to the flow input at',
    '  execution) or literal JSON values.',
    '- "onError" per step: "stop" (default), "continue", or "retry" (retries at most twice).',
    '- Never invent tool names, arguments, or behavior not present in the transcript.',
].join('\n');
export class Summarizer {
    inFlight = false;
    lastRunMs = 0;
    store;
    cfg;
    llm;
    persistence;
    publish;
    log;
    constructor(store, cfg, llm, persistence, publish, log) {
        this.store = store;
        this.cfg = cfg;
        this.llm = llm;
        this.persistence = persistence;
        this.publish = publish;
        this.log = log;
    }
    get busy() {
        return this.inFlight;
    }
    /** How many uncompiled traces are waiting since the last mined watermark. */
    pendingTraces() {
        return this.store
            .listSummarizableSessions()
            .reduce((sum, s) => sum + (s.last_seq - s.last_summarized_seq), 0);
    }
    shouldRun(minIntervalMs, now = Date.now()) {
        if (this.inFlight)
            return false;
        if (now - this.lastRunMs < minIntervalMs)
            return false;
        return this.valuableCandidates(1).length > 0;
    }
    /** Hot patterns that clear the repetition, cross-session, step, and value gates. */
    valuableCandidates(limit) {
        return this.store
            .getHotPatterns('flow-seq', this.cfg.minRepeat, 2, this.cfg.topK)
            .filter((p) => patternSteps(p.key) >= this.cfg.minFlowSteps &&
            patternValue(p.count, p.key) >= this.cfg.minPatternValue)
            .slice(0, limit);
    }
    async run(signal) {
        if (this.inFlight)
            return 0;
        this.inFlight = true;
        this.lastRunMs = Date.now();
        let compiled = 0;
        try {
            const candidates = this.valuableCandidates(this.cfg.topK);
            for (const pattern of candidates) {
                if (signal?.aborted)
                    break;
                const transcript = await this.buildTranscript(pattern.sample_session, pattern.key, signal);
                if (!transcript.tools.length)
                    continue;
                try {
                    const output = await this.compile(pattern.key, pattern.count, transcript, pattern.sample_session, signal);
                    const finalName = `${SKILL_PREFIX}${output.name}`;
                    const existing = this.store.getArtifact(finalName);
                    if (existing) {
                        const decision = await this.decideUpdate(existing, output, signal);
                        if (decision === 'skip') {
                            this.log(`deepjit: name collision on "${finalName}", LLM chose to keep existing`);
                            this.store.markPatternCompiled(pattern.id);
                            continue;
                        }
                    }
                    const { mode, filePath, name: publishedName } = await this.publish({ ...output, sourcePatternId: pattern.id });
                    this.store.insertArtifact({
                        type: output.type,
                        name: finalName,
                        title: output.title,
                        description: output.description,
                        file_path: filePath,
                        source_pattern_id: pattern.id,
                        status: 'active',
                        feedback_mode: mode,
                        llm_provider: this.cfg.llmProvider,
                        llm_model: this.cfg.llmModel,
                        summary: output.summary,
                    });
                    this.store.markPatternCompiled(pattern.id);
                    compiled++;
                    this.log(`deepjit: compiled "${output.name}" (${output.type}) from pattern "${pattern.key}"`);
                }
                catch (err) {
                    this.log(`deepjit: compile failed for pattern "${pattern.key}": ${err.message}`);
                }
            }
        }
        finally {
            this.inFlight = false;
        }
        return compiled;
    }
    async buildTranscript(sessionId, key, signal) {
        const names = key.split('>');
        const toolRows = this.store.readTracesSince(sessionId, 0, ['tool'], this.cfg.transcriptMaxRows);
        const seqs = toolRows.map((r) => {
            try {
                return { seq: r.seq, name: JSON.parse(r.payload).name ?? '' };
            }
            catch {
                return { seq: r.seq, name: '' };
            }
        });
        // locate the first window matching the pattern key
        let start = 0;
        outer: for (let i = 0; i + names.length <= seqs.length; i++) {
            for (let j = 0; j < names.length; j++) {
                if (seqs[i + j]?.name !== names[j])
                    continue outer;
            }
            start = i;
            break;
        }
        const fromSeq = Math.max(0, (seqs[start]?.seq ?? 0) - 4);
        const parts = [];
        let events = [];
        let drilled = false;
        if (this.persistence) {
            try {
                const { events: evs } = await this.persistence.readFrom(sessionId, fromSeq, signal);
                events = evs;
                drilled = true;
            }
            catch {
                drilled = false;
            }
        }
        if (drilled) {
            for (const ev of events) {
                const e = ev;
                if (e.type === 'user/message') {
                    const text = textOf(e.data);
                    if (text)
                        parts.push(`USER: ${text}`);
                }
                else if (e.type === 'tool/call') {
                    const d = e.data;
                    parts.push(`TOOL_CALL: ${d?.name ?? ''} ${trim(d?.arguments ?? '', this.cfg.maxResultChars)}`);
                }
                else if (e.type === 'tool/result') {
                    const d = e.data;
                    parts.push(`TOOL_RESULT${d?.error ? ' (error)' : ''}: ${textOf(d?.message)}`);
                }
            }
        }
        else {
            for (const row of toolRows) {
                try {
                    const p = JSON.parse(row.payload);
                    parts.push(`TOOL_CALL: ${p.name ?? ''} ${trim(p.args ?? '', this.cfg.maxResultChars)}`);
                    if (p.result_text)
                        parts.push(`TOOL_RESULT: ${p.result_text}`);
                }
                catch {
                    // skip
                }
            }
        }
        const tools = [...new Set(seqs.map((s) => s.name).filter(Boolean))];
        const text = parts.join('\n').slice(0, 12000);
        return { text, tools };
    }
    async compile(patternKey, count, transcript, sampleSession, signal) {
        const userMsg = [
            `Recurring workflow (observed ${count} times, tool sequence "${patternKey}").`,
            `Known tool names: ${transcript.tools.join(', ')}.`,
            '',
            'Transcript excerpt:',
            transcript.text,
            '',
            'Compile this workflow into a JSON artifact per the system rules.',
        ].join('\n');
        // Follow the user's configured model (captured from request/context events);
        // the plugin config only provides a fallback when no session has run yet.
        const sessionContext = this.store.latestSessionContext();
        const provider = sessionContext.provider ?? this.cfg.llmProvider;
        const model = sessionContext.model ?? this.cfg.llmModel;
        if (!model)
            throw new Error('no model available: configure llmModel or run a session first');
        let lastError = '';
        for (let attempt = 0; attempt < 2; attempt++) {
            const userContent = lastError
                ? `${userMsg}\n\nPrevious output was rejected: ${lastError}\nOutput only valid JSON.`
                : userMsg;
            const raw = await this.callLlm([
                { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] },
                { role: 'user', content: [{ type: 'text', text: userContent }] },
            ], provider, model, sampleSession, signal);
            try {
                const parsed = parseJson(raw);
                const artifact = validateArtifact(parsed, transcript.tools);
                return artifact;
            }
            catch (err) {
                lastError = err.message;
            }
        }
        throw new Error(`LLM output not usable after retries: ${lastError}`);
    }
    async callLlm(messages, provider, model, sessionId, signal) {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0)
                await new Promise((r) => setTimeout(r, attempt * 2000));
            let text = '';
            try {
                for await (const chunk of this.llm.stream({
                    provider,
                    model,
                    messages,
                    temperature: 0.2,
                    maxTokens: 4000,
                    sessionId,
                    signal,
                })) {
                    const c = chunk;
                    if (c.type === 'finish')
                        this.log(`deepjit: llm finish ${JSON.stringify(c.reason).slice(0, 500)}`);
                    if (c.type === 'text-delta' && typeof c.text === 'string')
                        text += c.text;
                }
            }
            catch (err) {
                lastError = err;
                this.log(`deepjit: llm stream attempt ${attempt + 1} threw: ${err.message}`);
                continue;
            }
            if (text)
                return text;
            lastError = new Error('LLM returned no text');
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
    /**
     * On a same-name collision, let the model compare the existing artifact with
     * the new one and decide whether to update. Defaults to 'skip' on any
     * failure so we never overwrite by accident.
     */
    async decideUpdate(existing, output, signal) {
        let existingContent = '';
        try {
            if (existsSync(existing.file_path))
                existingContent = readFileSync(existing.file_path, 'utf8');
        }
        catch {
            existingContent = '';
        }
        const newContent = output.type === 'skill'
            ? (output.content ?? '')
            : JSON.stringify(output.steps ?? []);
        const sessionContext = this.store.latestSessionContext();
        const provider = sessionContext.provider ?? this.cfg.llmProvider;
        const model = sessionContext.model ?? this.cfg.llmModel;
        if (!model)
            return 'skip';
        const prompt = [
            `An existing compiled artifact named "${existing.name}" already exists.`,
            '',
            'EXISTING:',
            existingContent.slice(0, 3000),
            '',
            'NEW CANDIDATE:',
            newContent.slice(0, 3000),
            '',
            'Do they describe the SAME workflow, and is the NEW one meaningfully better or more current?',
            'Answer with a single JSON object: {"action":"update"} to replace, or {"action":"skip"} to keep the existing.',
        ].join('\n');
        try {
            const raw = await this.callLlm([{ role: 'user', content: [{ type: 'text', text: prompt }] }], provider, model, existing.name, signal);
            const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
            return parsed.action === 'update' ? 'update' : 'skip';
        }
        catch {
            return 'skip';
        }
    }
}
function textOf(value) {
    const msg = value;
    const content = Array.isArray(msg?.content) ? msg.content : Array.isArray(value) ? value : null;
    if (!content)
        return '';
    return content
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
}
function trim(s, max) {
    return s.length <= max ? s : s.slice(0, max) + '…';
}
function parseJson(raw) {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    return JSON.parse(cleaned);
}
function validateArtifact(parsed, knownTools) {
    if (!parsed || typeof parsed !== 'object')
        throw new Error('not an object');
    const p = parsed;
    const type = p.type;
    if (type !== 'skill' && type !== 'flow')
        throw new Error(`unknown type "${String(type)}"`);
    const name = typeof p.name === 'string' ? p.name : '';
    if (!KEBAB.test(name))
        throw new Error(`invalid kebab-case name "${name}"`);
    const description = typeof p.description === 'string' ? p.description : '';
    if (!description)
        throw new Error('missing description');
    const title = typeof p.title === 'string' ? p.title : name;
    if (type === 'skill') {
        const content = typeof p.content === 'string' && p.content.trim() ? p.content.trim() : '';
        if (!content)
            throw new Error('skill missing content');
        return {
            type,
            name,
            title,
            description,
            whenToUse: typeof p.whenToUse === 'string' ? p.whenToUse : undefined,
            content,
            summary: `JIT-compiled from recurring workflow; description: ${description}`,
            sourcePatternId: -1,
        };
    }
    const stepsRaw = Array.isArray(p.steps) ? p.steps : [];
    if (stepsRaw.length === 0)
        throw new Error('flow missing steps');
    const known = new Set(knownTools);
    const steps = [];
    for (const raw of stepsRaw) {
        const s = raw;
        const tool = typeof s.tool === 'string' ? s.tool : '';
        if (!tool)
            throw new Error(`flow step missing tool`);
        if (tool === 'deepjit_status')
            throw new Error(`flow step may not invoke deepjit_status`);
        if (!known.has(tool) && tool !== 'deepjit_flow') {
            throw new Error(`flow step references unknown tool "${tool}"`);
        }
        const onError = s.onError;
        if (onError !== undefined && onError !== 'stop' && onError !== 'continue' && onError !== 'retry') {
            throw new Error(`invalid onError "${String(onError)}"`);
        }
        const timeoutMs = typeof s.timeoutMs === 'number' && s.timeoutMs > 0 ? s.timeoutMs : undefined;
        steps.push({
            tool,
            args: s.args && typeof s.args === 'object' && !Array.isArray(s.args)
                ? s.args
                : {},
            onError: onError,
            timeoutMs,
        });
    }
    return {
        type,
        name,
        title,
        description,
        whenToUse: typeof p.whenToUse === 'string' ? p.whenToUse : undefined,
        steps,
        summary: `JIT-compiled flow (${steps.length} steps) from recurring workflow; description: ${description}`,
        sourcePatternId: -1,
    };
}
//# sourceMappingURL=summarizer.js.map