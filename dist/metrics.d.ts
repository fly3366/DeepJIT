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
