/**
 * Compiler "optimize" pass (AOT): validate a candidate flow against the live
 * tool registry and constant-fold literal arguments ahead of time, so the
 * runtime executor does less work and bad flows are rejected at compile time.
 *
 * Mirrors a compiler's middle-end: it never performs side effects, only
 * analysis + rewriting of the IR (the step list).
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
 * Validate and partially-evaluate a flow IR. Throws if a step references a
 * tool that does not exist in the live registry (and is not a nested flow).
 */
export declare function optimizeFlow(steps: FlowStepIR[], ctx: AotContext): OptimizedFlow;
