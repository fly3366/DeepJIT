/**
 * Web UI data channel: an exact Connection Fetch route exposing read-only
 * DeepJIT status as JSON to the plugin's own browser half (web/client.js).
 *
 * Uses the lightest dsh channel — a Host-registered exact Fetch route — rather
 * than Typert codegen. The browser calls it document-relative (`api/deepjit/status`);
 * auth is the framework's same-origin owner-peer cookie. `connection` is
 * web-profile-only, so index.ts registers this through a nested
 * `ctx.inject(['connection'], ...)` and headless behavior is unchanged.
 *
 * The payload deliberately excludes host filesystem paths and session ids:
 * `file_path` becomes a boolean `fileOk`, and `sample_session` is dropped.
 */
import { existsSync } from 'node:fs';
import { qualityScore } from './store.js';
import { metrics } from './metrics.js';
export const STATUS_PATH = '/api/deepjit/status';
/** Pure payload builder — reused by the route and unit-testable without a Request. */
export function buildStatusPayload(store) {
    const artifacts = store.listArtifacts().map((r) => ({
        name: r.name,
        type: r.type,
        title: r.title,
        description: r.description,
        status: r.status,
        quality: qualityScore(r.use_count, r.success_count),
        use_count: r.use_count,
        success_count: r.success_count,
        created_ms: r.created_ms,
        updated_ms: r.updated_ms,
        last_used_ms: r.last_used_ms,
        fileOk: existsSync(r.file_path),
    }));
    const patterns = store.getHotPatterns('flow-seq', 2, 1, 20).map((p) => ({
        kind: p.kind,
        key: p.key,
        count: p.count,
        sessions_seen: p.sessions_seen,
        last_seen_ms: p.last_seen_ms,
    }));
    return { artifacts, patterns, stats: store.stats(), metrics: metrics.snapshot() };
}
/** Register the GET status route on the (web-only) connection service. */
export function registerStatusRoutes(ctx, deps) {
    const connection = Reflect.get(ctx, 'connection');
    if (!connection)
        return;
    const { store, log } = deps;
    connection.fetch.register({
        path: STATUS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async (request) => {
            try {
                request.signal.throwIfAborted();
                return Response.json(buildStatusPayload(store));
            }
            catch (err) {
                // Host log only; the browser gets a stable code, never err.message (host paths).
                log(`deepjit: status route error: ${err.message}`);
                return Response.json({ error: 'status-unavailable' }, { status: 500 });
            }
        },
    });
}
//# sourceMappingURL=status-routes.js.map