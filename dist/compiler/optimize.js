/**
 * Compiler "optimize" pass (AOT): validate a candidate flow against the live
 * tool registry and constant-fold literal arguments ahead of time, so the
 * runtime executor does less work and bad flows are rejected at compile time.
 *
 * Mirrors a compiler's middle-end: it never performs side effects, only
 * analysis + rewriting of the IR (the step list).
 */
const TEMPLATE_RE = /^\$\{input\.(.+)\}$/;
function isTemplate(value) {
    return typeof value === 'string' && TEMPLATE_RE.test(value);
}
function foldValue(value, stats) {
    if (isTemplate(value)) {
        stats.dynamic++;
    }
    else if (Array.isArray(value)) {
        for (const item of value)
            foldValue(item, stats);
    }
    else if (value && typeof value === 'object') {
        for (const key of Object.keys(value))
            foldValue(value[key], stats);
    }
    else {
        stats.folded++; // literal: nothing to resolve at runtime
    }
}
function foldArgs(args, stats) {
    for (const key of Object.keys(args))
        foldValue(args[key], stats);
}
/**
 * Validate and partially-evaluate a flow IR. Throws if a step references a
 * tool that does not exist in the live registry (and is not a nested flow).
 */
export function optimizeFlow(steps, ctx) {
    const stats = { folded: 0, dynamic: 0 };
    for (const step of steps) {
        if (step.tool !== 'deepjit_flow' && !ctx.toolExists(step.tool)) {
            throw new Error(`AOT: flow references tool not in live registry: "${step.tool}"`);
        }
        foldArgs(step.args ?? {}, stats);
    }
    return { steps, foldedLiterals: stats.folded, dynamicBindings: stats.dynamic };
}
//# sourceMappingURL=optimize.js.map