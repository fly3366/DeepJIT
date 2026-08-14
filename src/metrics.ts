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

import { metrics as otel, type Counter, type Histogram } from '@opentelemetry/api'

interface Timing {
  count: number
  sum: number
  max: number
}

class Metrics {
  private counters = new Map<string, number>()
  private timings = new Map<string, Timing>()
  private otelCounters = new Map<string, Counter>()
  private otelHistograms = new Map<string, Histogram>()

  private meter() {
    return otel.getMeter('deepjit')
  }

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by)
    let c = this.otelCounters.get(name)
    if (!c) {
      c = this.meter().createCounter(name)
      this.otelCounters.set(name, c)
    }
    c.add(by)
  }

  /** Record a duration sample (ms). */
  observe(name: string, ms: number): void {
    const t = this.timings.get(name) ?? { count: 0, sum: 0, max: 0 }
    t.count++
    t.sum += ms
    if (ms > t.max) t.max = ms
    this.timings.set(name, t)
    let h = this.otelHistograms.get(name)
    if (!h) {
      h = this.meter().createHistogram(name, { unit: 'ms' })
      this.otelHistograms.set(name, h)
    }
    h.record(ms)
  }

  get(name: string): number {
    return this.counters.get(name) ?? 0
  }

  /** Flatten counters + timing stats into a plain snapshot for reporting. */
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [k, v] of this.counters) out[k] = v
    for (const [k, t] of this.timings) {
      out[`${k}.count`] = t.count
      out[`${k}.sum_ms`] = Math.round(t.sum)
      out[`${k}.max_ms`] = Math.round(t.max)
      out[`${k}.avg_ms`] = t.count ? Math.round(t.sum / t.count) : 0
    }
    return out
  }

  reset(): void {
    this.counters.clear()
    this.timings.clear()
  }
}

/** Process-wide metrics singleton. */
export const metrics = new Metrics()
