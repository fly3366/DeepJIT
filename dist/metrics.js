/**
 * Lightweight in-process metrics for the DeepJIT pipeline.
 *
 * dsh's own observability (session-telemetry-otel) only exports agent-session
 * events as OTel logs; it does not expose plugin-facing counters. This module
 * gives DeepJIT its own counters + timing histograms, readable via
 * `deepjit_status {action:"metrics"}`.
 *
 * Kept as a process-local singleton: metrics describe the running plugin
 * instance and reset on restart (durable stats live in the SQLite tables).
 */
class Metrics {
    counters = new Map();
    timings = new Map();
    inc(name, by = 1) {
        this.counters.set(name, (this.counters.get(name) ?? 0) + by);
    }
    /** Record a duration sample (ms). */
    observe(name, ms) {
        const t = this.timings.get(name) ?? { count: 0, sum: 0, max: 0 };
        t.count++;
        t.sum += ms;
        if (ms > t.max)
            t.max = ms;
        this.timings.set(name, t);
    }
    get(name) {
        return this.counters.get(name) ?? 0;
    }
    /** Flatten counters + timing stats into a plain snapshot for reporting. */
    snapshot() {
        const out = {};
        for (const [k, v] of this.counters)
            out[k] = v;
        for (const [k, t] of this.timings) {
            out[`${k}.count`] = t.count;
            out[`${k}.sum_ms`] = Math.round(t.sum);
            out[`${k}.max_ms`] = Math.round(t.max);
            out[`${k}.avg_ms`] = t.count ? Math.round(t.sum / t.count) : 0;
        }
        return out;
    }
    reset() {
        this.counters.clear();
        this.timings.clear();
    }
}
/** Process-wide metrics singleton. */
export const metrics = new Metrics();
//# sourceMappingURL=metrics.js.map