import type { Context } from '@deepseek-ai/cordis';
import { DeepJitStore } from './store.ts';
import type { StatusTool } from './status-tool.ts';
export declare const STATUS_PATH = "/api/deepjit/status";
export declare const ACTION_PATH = "/api/deepjit/action";
declare const ACTION_ALLOWLIST: readonly ['enable', 'disable', 'delete'];
export type ActionName = (typeof ACTION_ALLOWLIST)[number];
/**
 * Defense-in-depth against path traversal in feedback's path.join: artifact
 * names are lowercase kebab (as the compiler enforces). Rejects separators,
 * dot-segments and leading dots on top of the getArtifact existence gate.
 */
export declare function isValidArtifactName(name: unknown): name is string;
export interface ArtifactView {
    name: string;
    type: 'skill' | 'flow';
    title: string | null;
    description: string | null;
    status: 'active' | 'disabled';
    quality: number;
    use_count: number;
    success_count: number;
    created_ms: number;
    updated_ms: number;
    last_used_ms: number | null;
    fileOk: boolean;
}
export interface PatternView {
    kind: string;
    key: string;
    count: number;
    sessions_seen: number;
    last_seen_ms: number;
}
export interface StatusPayload {
    artifacts: ArtifactView[];
    patterns: PatternView[];
    stats: {
        traces: number;
        sessions: number;
        patterns: number;
        artifacts: number;
    };
    metrics: Record<string, number>;
}
/** Pure payload builder — reused by the route and unit-testable without a Request. */
export declare function buildStatusPayload(store: DeepJitStore): StatusPayload;
export interface StatusRouteDeps {
    store: DeepJitStore;
    statusTool: StatusTool;
    log: (msg: string) => void;
}
/** Register the GET status + POST action routes on the (web-only) connection service. */
export declare function registerStatusRoutes(ctx: Context, deps: StatusRouteDeps): void;
export {};
