import { readFileSync } from 'node:fs';
import path from 'node:path';
import { t } from "./i18n.js";
const TEMPLATE_RE = /^\$\{input\.(.+)\}$/;
function resolveValue(value, input) {
    if (typeof value === 'string') {
        const match = TEMPLATE_RE.exec(value);
        if (match?.[1])
            return getPath(input, match[1]);
        return value;
    }
    if (Array.isArray(value))
        return value.map((v) => resolveValue(v, input));
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[k] = resolveValue(v, input);
        return out;
    }
    return value;
}
function getPath(obj, dotted) {
    let cur = obj;
    for (const part of dotted.split('.')) {
        if (cur && typeof cur === 'object')
            cur = cur[part];
        else
            return undefined;
    }
    return cur;
}
function resultSummary(result, maxChars) {
    const r = result;
    if (r?.isError)
        return r.error?.message ?? 'tool failed';
    const content = Array.isArray(r?.content)
        ? r.content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
        : '';
    const value = r?.value === undefined ? '' : JSON.stringify(r.value);
    const text = (content || value || '').trim();
    return text.length <= maxChars ? text : text.slice(0, maxChars) + '…';
}
/** The deepjit_flow tool: replays a compiled flow template with new inputs. */
export class FlowExecutor {
    flowDir;
    store;
    execute;
    makeCallId;
    stepTimeoutMs;
    maxResultChars;
    log;
    constructor(flowDir, store, execute, makeCallId, stepTimeoutMs, maxResultChars, log) {
        this.flowDir = flowDir;
        this.store = store;
        this.execute = execute;
        this.makeCallId = makeCallId;
        this.stepTimeoutMs = stepTimeoutMs;
        this.maxResultChars = maxResultChars;
        this.log = log;
    }
    get toolDefinition() {
        return {
            name: 'deepjit_flow',
            description: 'Execute a JIT-compiled flow template with new arguments. The template was compiled by deepjit from ' +
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
                render: (_args, value) => [{ type: 'text', text: String(value) }],
            },
            execute: async (args, exec) => {
                return this.run(args.flow, args.args ?? {}, exec.agent, exec.signal);
            },
        };
    }
    static MAX_DEPTH = 3;
    async run(flowName, input, agent, signal, depth = 0) {
        const artifact = this.store.getArtifact(flowName);
        if (!artifact || artifact.type !== 'flow') {
            throw new Error(t('flow.unknown', { name: flowName }));
        }
        if (artifact.status === 'disabled')
            throw new Error(t('flow.disabled', { name: flowName }));
        const template = JSON.parse(readFileSync(path.join(this.flowDir, `${flowName}.json`), 'utf8'));
        if (!Array.isArray(template.steps) || template.steps.length === 0) {
            throw new Error(t('flow.noSteps', { name: flowName }));
        }
        if (template.steps.some((s) => s.tool === 'deepjit_status')) {
            throw new Error(t('flow.recursive', { name: flowName }));
        }
        const outcomes = [];
        for (let i = 0; i < template.steps.length; i++) {
            if (signal.aborted)
                break;
            const step = template.steps[i];
            const resolvedArgs = resolveValue(step.args ?? {}, input);
            // Nested flow: recurse with the step's args as the child input, depth-limited.
            if (step.tool === 'deepjit_flow') {
                if (depth + 1 > FlowExecutor.MAX_DEPTH) {
                    outcomes.push({ index: i + 1, tool: step.tool, ok: false, error: t('flow.recursive', { name: flowName }) });
                    break;
                }
                const nestedFlow = String(resolvedArgs.flow ?? '');
                const nestedInput = (resolvedArgs.args ?? {});
                try {
                    const nested = await this.run(nestedFlow, nestedInput, agent, signal, depth + 1);
                    outcomes.push({ index: i + 1, tool: `${step.tool}:${nestedFlow}`, ok: nested.ok, summary: `${nested.steps.length} nested steps` });
                    if (!nested.ok && step.onError === 'stop')
                        break;
                }
                catch (err) {
                    outcomes.push({ index: i + 1, tool: `${step.tool}:${nestedFlow}`, ok: false, error: err.message });
                    if (step.onError === 'stop')
                        break;
                }
                continue;
            }
            const timeoutMs = step.timeoutMs ?? this.stepTimeoutMs;
            let attempts = step.onError === 'retry' ? 2 : 0;
            let result;
            let lastError;
            for (let attempt = 0; attempt <= attempts; attempt++) {
                if (signal.aborted)
                    break;
                try {
                    result = await this.execute({
                        callId: this.makeCallId(crypto.randomUUID()),
                        name: step.tool,
                        arguments: resolvedArgs,
                        agent,
                        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
                    });
                    const r = result;
                    if (r?.isError) {
                        lastError = r.error?.message ?? `step failed (${step.tool})`;
                        if (attempt < attempts) {
                            this.log(`deepjit: flow ${flowName} step ${i + 1} failed, retrying (${attempt + 1}/2)`);
                            continue;
                        }
                    }
                    else {
                        lastError = undefined;
                    }
                    break;
                }
                catch (err) {
                    lastError = err.message;
                    if (attempt < attempts)
                        continue;
                    break;
                }
            }
            const ok = !lastError;
            outcomes.push({
                index: i + 1,
                tool: step.tool,
                ok,
                error: lastError,
                summary: ok ? resultSummary(result, this.maxResultChars) : undefined,
            });
            if (!ok && step.onError === 'stop')
                break;
            if (!ok && step.onError !== 'continue' && step.onError !== 'retry')
                break;
        }
        return { ok: outcomes.every((o) => o.ok) && !signal.aborted, steps: outcomes };
    }
}
//# sourceMappingURL=flow-executor.js.map