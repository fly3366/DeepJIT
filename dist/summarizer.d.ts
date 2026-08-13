import { DeepJitStore } from './store.ts';
import type { ArtifactRow } from './store.ts';
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
}
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
    constructor(store: DeepJitStore, cfg: SummarizerConfig, llm: LlmLike, persistence: SessionPersistenceLike | undefined, publish: PublishFn, log: (msg: string) => void);
    get busy(): boolean;
    /** How many uncompiled traces are waiting since the last mined watermark. */
    pendingTraces(): number;
    shouldRun(minIntervalMs: number, now?: number): boolean;
    run(signal?: AbortSignal): Promise<number>;
    private buildTranscript;
    private compile;
    private callLlm;
}
export type { ArtifactRow };
