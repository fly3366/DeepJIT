/**
 * Compiler "optimize" pass (AOT): validate a candidate flow against the live
 * tool registry and report how many argument values are compile-time literals
 * versus runtime `${input.*}` bindings, so bad flows are rejected at compile time.
 *
 * Analysis only — it never performs side effects and returns the step list
 * unchanged (no rewriting); the folded/dynamic counts are informational.
 */
export interface FlowStepIR {
    tool: string;
    args: Record<string, unknown>;
    onError?: 'stop' | 'continue' | 'retry';
    timeoutMs?: number;
}
export interface AotContext {
    /** Live tool-registry lookup; nested deepjit_flow is always allowed. */
    toolExists: (name: string) => boolean;
}
export interface OptimizedFlow {
    steps: FlowStepIR[];
    /** Number of argument values resolved at compile time (constant-folded). */
    foldedLiterals: number;
    /** Number of arguments left for runtime binding (${input.*}). */
    dynamicBindings: number;
}
/**
 * Validate a flow IR against the live registry and count literal vs dynamic
 * args. Throws if a step references a tool that does not exist in the live
 * registry (and is not a nested deepjit_flow). The steps are returned unchanged.
 */
export declare function optimizeFlow(steps: FlowStepIR[], ctx: AotContext): OptimizedFlow;
