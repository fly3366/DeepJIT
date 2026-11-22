/**
 * Lightweight in-process metrics for the DeepJIT pipeline.
 *
 * dsh's official telemetry (the dsh-otel channel factory plus its session/
 * product adapters) covers dsh's own events, installs no global OTel provider,
 * and exposes no plugin-facing counters. This module gives DeepJIT its own
 * counters + timing histograms, readable via `deepjit_status {action:"metrics"}`
 * and mirrored to OTel instruments whenever a provider is registered (e.g. by
 * dsh-o11y-plugin); without one the OTel half is no-op.
 *
 * Kept as a process-local singleton: metrics describe the running plugin
 * instance and reset on restart (durable stats live in the SQLite tables).
 */
declare class Metrics {
    private counters;
    private timings;
    private otelCounters;
    private otelHistograms;
    private meter;
    inc(name: string, by?: number): void;
    /** Record a duration sample (ms). */
    observe(name: string, ms: number): void;
    get(name: string): number;
    /** Flatten counters + timing stats into a plain snapshot for reporting. */
    snapshot(): Record<string, number>;
    reset(): void;
}
/** Process-wide metrics singleton. */
export declare const metrics: Metrics;
export {};
