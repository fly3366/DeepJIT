import { DeepJitStore } from './store.ts';
export interface FlowStep {
    tool: string;
    args: Record<string, unknown>;
    onError?: 'stop' | 'continue' | 'retry';
    timeoutMs?: number;
}
export interface FlowTemplate {
    name: string;
    description: string;
    whenToUse?: string;
    steps: FlowStep[];
}
export interface StepOutcome {
    index: number;
    tool: string;
    ok: boolean;
    error?: string;
    summary?: string;
}
export interface ExecuteFn {
    (input: {
        callId: unknown;
        name: string;
        arguments: Record<string, unknown>;
        agent?: unknown;
        signal: AbortSignal;
    }): Promise<unknown>;
}
/** The deepjit_flow tool: replays a compiled flow template with new inputs. */
export declare class FlowExecutor {
    private flowDir;
    private store;
    private execute;
    private makeCallId;
    private stepTimeoutMs;
    private maxResultChars;
    private log;
    constructor(flowDir: string, store: DeepJitStore, execute: ExecuteFn, makeCallId: (uuid: string) => unknown, stepTimeoutMs: number, maxResultChars: number, log: (msg: string) => void);
    get toolDefinition(): object;
    static readonly MAX_DEPTH = 3;
    run(flowName: string, input: Record<string, unknown>, agent: unknown, signal: AbortSignal, depth?: number): Promise<{
        ok: boolean;
        steps: StepOutcome[];
    }>;
}
