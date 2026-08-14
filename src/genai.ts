/**
 * OpenTelemetry Generative-AI semantic conventions (gen_ai.*) for LLM calls.
 * Attribute names follow the OTel GenAI semconv (experimental but widely
 * adopted), so backends that understand gen_ai.* render rich LLM spans.
 *
 * Emitted through the standard @opentelemetry/api; when dsh-o11y-plugin
 * registers global providers these spans export via OTLP, otherwise no-op.
 */
import { trace, metrics, SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api'

const TRACER = 'deepjit'
const METER = 'deepjit'

/** Record the standard GenAI client token-usage metric (input/output). */
export function recordTokenUsage(model: string, usage: LlmUsage): void {
  const meter = metrics.getMeter(METER)
  const hist = meter.createHistogram('gen_ai.client.token.usage', { unit: '{token}' })
  if (usage.inputTokens !== undefined) {
    hist.record(usage.inputTokens, { 'gen_ai.request.model': model, 'gen_ai.token.type': 'input' })
  }
  if (usage.outputTokens !== undefined) {
    hist.record(usage.outputTokens, { 'gen_ai.request.model': model, 'gen_ai.token.type': 'output' })
  }
}

export interface LlmSpanInput {
  operation?: string
  system?: string
  model: string
  temperature?: number
  maxTokens?: number
}

export interface LlmUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

/** Start a client span for one LLM request, tagged with gen_ai.* attributes. */
export function startLlmSpan(input: LlmSpanInput): Span {
  const tracer = trace.getTracer(TRACER)
  return tracer.startSpan(`chat ${input.model}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'gen_ai.operation.name': input.operation ?? 'chat',
      'gen_ai.system': input.system ?? 'deepseek',
      'gen_ai.request.model': input.model,
      ...(input.temperature !== undefined ? { 'gen_ai.request.temperature': input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { 'gen_ai.request.max_tokens': input.maxTokens } : {}),
    },
  })
}

/** Finish an LLM span, recording gen_ai usage and error status. */
export function endLlmSpan(span: Span, usage: LlmUsage | undefined, error?: unknown): void {
  if (usage) {
    if (usage.inputTokens !== undefined) span.setAttribute('gen_ai.usage.input_tokens', usage.inputTokens)
    if (usage.outputTokens !== undefined) span.setAttribute('gen_ai.usage.output_tokens', usage.outputTokens)
    if (usage.reasoningTokens !== undefined) span.setAttribute('gen_ai.usage.reasoning_tokens', usage.reasoningTokens)
  }
  if (error) {
    span.recordException(error instanceof Error ? error : new Error(String(error)))
    span.setStatus({ code: SpanStatusCode.ERROR })
  } else {
    span.setStatus({ code: SpanStatusCode.OK })
  }
  span.end()
}
