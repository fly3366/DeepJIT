import { DeepJitStore } from './store.ts';
import type { ArtifactRow } from './store.ts';
import { type AotContext } from './compiler/optimize.ts';
/** Prefix applied to every published artifact name. */
export declare const SKILL_PREFIX = "deepjit-";
export interface CompiledArtifact {
    type: 'skill' | 'flow';
    name: string;
    title: string;
    description: string;
    whenToUse?: string;
    content?: string;
    steps?: FlowStep[];
    summary: string;
    sourcePatternId: number;
}
export interface FlowStep {
    tool: string;
    args: Record<string, unknown>;
    onError?: 'stop' | 'continue' | 'retry';
    timeoutMs?: number;
}
export interface SummarizerConfig {
    llmProvider: string;
    llmModel: string;
    maxResultChars: number;
    minRepeat: number;
    topK: number;
    minFlowSteps: number;
    minPatternValue: number;
    transcriptMaxRows: number;
}
/** Number of tool steps encoded in a flow-seq pattern key ("a>b>c" => 3). */
export declare function patternSteps(key: string): number;
/**
 * Heuristic worth of compiling a pattern: repetition x length. A single tool
 * repeated often, or a long flow seen rarely, both score low; only flows that
 * are both repeated AND multi-step justify an LLM compile.
 */
export declare function patternValue(count: number, key: string): number;
/** Minimal structural surface of ctx.llm so the module stays testable. */
export interface LlmLike {
    stream(options: {
        provider: string;
        model: string;
        messages: unknown[];
        system?: string;
        temperature?: number;
        maxTokens?: number;
        sessionId?: unknown;
        signal?: AbortSignal;
    }): AsyncIterable<unknown>;
}
export interface SessionPersistenceLike {
    readFrom(id: unknown, fromSeq: number, signal?: AbortSignal): Promise<{
        events: unknown[];
    }>;
}
export interface PublishFn {
    (artifact: Omit<CompiledArtifact, 'sourcePatternId'> & {
        sourcePatternId: number;
    }): Promise<{
        mode: 'filesystem' | 'runtime';
        filePath: string;
        name: string;
    }>;
}
export declare class Summarizer {
    private inFlight;
    private lastRunMs;
    private store;
    private cfg;
    private llm;
    private persistence;
    private publish;
    private log;
    private aot?;
    constructor(store: DeepJitStore, cfg: SummarizerConfig, llm: LlmLike, persistence: SessionPersistenceLike | undefined, publish: PublishFn, log: (msg: string) => void, aot?: AotContext);
    get busy(): boolean;
    /** How many uncompiled traces are waiting since the last mined watermark. */
    pendingTraces(): number;
    shouldRun(minIntervalMs: number, now?: number): boolean;
    /** Hot patterns that clear the repetition, cross-session, step, and value gates. */
    private valuableCandidates;
    run(signal?: AbortSignal): Promise<number>;
    /**
     * Tier promotion: recompile a hot skill's source pattern as a flow (tier 2).
     * Returns the published flow name, or undefined on failure.
     */
    compilePatternAsFlow(patternId: number, signal?: AbortSignal): Promise<string | undefined>;
    private buildTranscript;
    private compile;
    private callLlm;
    /**
     * On a same-name collision, let the model compare the existing artifact with
     * the new one and decide whether to update. Defaults to 'skip' on any
     * failure so we never overwrite by accident.
     */
    private decideUpdate;
}
export type { ArtifactRow };
