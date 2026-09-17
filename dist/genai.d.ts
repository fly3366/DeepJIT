/**
 * OpenTelemetry Generative-AI semantic conventions (gen_ai.*) for LLM calls.
 * Attribute names follow the OTel GenAI semconv (experimental but widely
 * adopted), so backends that understand gen_ai.* render rich LLM spans.
 *
 * Emitted through the standard @opentelemetry/api; when dsh-o11y-plugin
 * registers global providers these spans export via OTLP, otherwise no-op.
 */
import { type Span, type SpanAttributes } from '@opentelemetry/api';
/** Record the standard GenAI client token-usage metric (input/output). */
export declare function recordTokenUsage(model: string, usage: LlmUsage): void;
export interface LlmSpanInput {
    operation?: string;
    system?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
}
export interface LlmUsage {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
}
/**
 * Build the gen_ai.* attribute set for one LLM client span. Pure so the
 * semconv keys are unit-testable without registering an OTel SDK provider.
 * `gen_ai.provider.name` is the current semconv key; `gen_ai.system` is its
 * deprecated predecessor, still emitted so older backends keep rendering.
 */
export declare function llmSpanAttributes(input: LlmSpanInput): SpanAttributes;
/** Start a client span for one LLM request, tagged with gen_ai.* attributes. */
export declare function startLlmSpan(input: LlmSpanInput): Span;
/** Finish an LLM span, recording gen_ai usage and error status. */
export declare function endLlmSpan(span: Span, usage: LlmUsage | undefined, error?: unknown): void;
