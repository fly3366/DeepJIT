import { appendFileSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { CallId } from '@deepseek-ai/dsh-llm';
import '@deepseek-ai/dsh-session';
import '@deepseek-ai/dsh-tools';
import '@deepseek-ai/cordis-plugin-timer';
export { Config } from "./config.js";
import { DeepJitStore } from "./store.js";
import { TraceCollector } from "./collector.js";
import { mineHotPatterns } from "./miner.js";
import { Summarizer } from "./summarizer.js";
import { ArtifactFeedback } from "./feedback.js";
import { FlowExecutor } from "./flow-executor.js";
import { StatusTool } from "./status-tool.js";
import { resolveDirs } from "./paths.js";
import { setLocale } from "./i18n.js";
export const name = 'deepjit';
export const inject = ['llm', 'skills', 'tools', 'sessionPersistence', 'timer'];
const callIdFactory = (uuid) => CallId(uuid);
/**
 * Best-effort read of the harness locale (web client `locale` settings
 * namespace). Returns undefined when absent (e.g. headless), letting i18n
 * fall back to the environment, then English.
 */
function readDshLocale(ctx) {
    try {
        const value = ctx
            .settings?.scope?.('locale')?.get?.();
        if (value && typeof value === 'object' && 'preference' in value) {
            return value.preference;
        }
    }
    catch {
        // dsh locale is optional
    }
    return undefined;
}
export function apply(ctx, config) {
    if (!config.enabled)
        return;
    setLocale(config.locale, readDshLocale(ctx));
    const dirs = resolveDirs(ctx, config);
    const store = new DeepJitStore(dirs.dbPath);
    const collector = new TraceCollector(store, () => collector.flushSync(), config.maxResultChars, config.flushBatchSize);
    const log = (msg) => {
        ;
        ctx.logger?.info(msg);
        try {
            appendFileSync(pathJoin(dirs.home, 'deepjit', 'deepjit.log'), `${new Date().toISOString()} ${msg}\n`);
        }
        catch {
            // logging is best-effort
        }
    };
    const skillsService = ctx.skills;
    const skillsAdapter = skillsService
        ? {
            register: (s) => skillsService.register(s),
            get: (name) => skillsService.get(name),
            on: (event, handler) => {
                const off = ctx.on(event, handler);
                return () => {
                    if (typeof off === 'function')
                        off();
                };
            },
        }
        : { register: () => () => { }, get: async () => undefined, on: () => () => { } };
    const feedback = new ArtifactFeedback({ skillDir: dirs.skillDir, flowDir: dirs.flowDir }, skillsAdapter, log);
    const persistence = ctx.sessionPersistence;
    const llm = ctx.llm;
    const summarizer = new Summarizer(store, {
        llmProvider: config.llmProvider,
        llmModel: config.llmModel,
        maxResultChars: config.maxResultChars,
        minRepeat: config.minRepeat,
        topK: config.topK,
        minFlowSteps: config.minFlowSteps,
        minPatternValue: config.minPatternValue,
    }, { stream: (o) => llm.stream(o) }, persistence, (artifact) => feedback.publish(artifact), log);
    const tools = ctx.tools;
    const flowExecutor = new FlowExecutor(dirs.flowDir, store, (input) => tools.execute(input), callIdFactory, config.stepTimeoutMs, config.maxResultChars, log);
    const statusTool = new StatusTool(store, feedback, dirs, log);
    // capture
    ctx.on('session/event', (session, event) => {
        collector.handleEvent(session?.id, event);
    });
    ctx.on('tools/result', (exec, result) => {
        collector.handleToolResult(exec, result);
    });
    ctx.on('session/flush', () => collector.flushSync());
    ctx.interval(() => collector.flushSync(), config.flushIntervalMs);
    // JIT cycle: mine hot paths, then compile the strongest ones
    ctx.interval(() => {
        mineHotPatterns(store, config);
        if (config.gcEnabled) {
            const removed = store.gcStale(Date.now(), config.gcStaleMs, config.gcProtectMs);
            for (const name of removed)
                log(`deepjit: gc disabled stale artifact ${name}`);
        }
        if (!summarizer.shouldRun(config.minIntervalMs))
            return;
        void summarizer.run().catch((err) => log(`deepjit: jit run failed: ${err.message}`));
    }, config.summarizeIntervalMs);
    ctx.tools.register(flowExecutor.toolDefinition);
    ctx.tools.register(statusTool.toolDefinition);
    ctx.effect(() => async () => {
        collector.flushSync();
        const deadline = Date.now() + 10_000;
        while (summarizer.busy && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 200));
        }
        feedback.disposeAll();
        store.close();
    });
}
//# sourceMappingURL=index.js.map