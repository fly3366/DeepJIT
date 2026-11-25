import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startLlmSpan, endLlmSpan, llmSpanAttributes, recordTokenUsage } from '../src/genai.ts'

test('genai: recordTokenUsage caches its instrument and is safe to call repeatedly', () => {
  assert.doesNotThrow(() => recordTokenUsage('deepseek-v4-flash', { inputTokens: 10, outputTokens: 5 }))
  // Second call reuses the cached histogram; empty/partial usage records nothing.
  assert.doesNotThrow(() => recordTokenUsage('deepseek-v4-flash', {}))
  assert.doesNotThrow(() => recordTokenUsage('m', { inputTokens: 1 }))
})

test('genai: start/end span with usage and error do not throw (no-op without provider)', () => {
  const span = startLlmSpan({ model: 'deepseek-v4-flash', temperature: 0.2, maxTokens: 100 })
  assert.equal(typeof span.setAttribute, 'function')
  assert.equal(typeof span.end, 'function')
  endLlmSpan(span, { inputTokens: 10, outputTokens: 5 })

  const errSpan = startLlmSpan({ model: 'm' })
  endLlmSpan(errSpan, undefined, new Error('boom'))
})

test('genai: endLlmSpan emits both legacy and new-spec reasoning token keys', () => {
  const attrs: Record<string, unknown> = {}
  const fakeSpan = {
    setAttribute: (k: string, v: unknown) => { attrs[k] = v },
    recordException: () => {},
    setStatus: () => {},
    end: () => {},
  } as unknown as Parameters<typeof endLlmSpan>[0]
  endLlmSpan(fakeSpan, { inputTokens: 10, outputTokens: 5, reasoningTokens: 3 })
  assert.equal(attrs['gen_ai.usage.input_tokens'], 10)
  assert.equal(attrs['gen_ai.usage.output_tokens'], 5)
  assert.equal(attrs['gen_ai.usage.reasoning_tokens'], 3, 'legacy reasoning key kept')
  assert.equal(attrs['gen_ai.usage.reasoning.output_tokens'], 3, 'new-spec reasoning alias added')
})

test('genai: endLlmSpan omits reasoning keys when no reasoning tokens reported', () => {
  const attrs: Record<string, unknown> = {}
  const fakeSpan = {
    setAttribute: (k: string, v: unknown) => { attrs[k] = v },
    recordException: () => {},
    setStatus: () => {},
    end: () => {},
  } as unknown as Parameters<typeof endLlmSpan>[0]
  endLlmSpan(fakeSpan, { inputTokens: 4, outputTokens: 2 })
  assert.equal('gen_ai.usage.reasoning_tokens' in attrs, false)
  assert.equal('gen_ai.usage.reasoning.output_tokens' in attrs, false)
})

test('genai: llmSpanAttributes emits provider.name + deprecated system alias and defaults', () => {
  const attrs = llmSpanAttributes({ model: 'deepseek-v4-flash' })
  assert.equal(attrs['gen_ai.provider.name'], 'deepseek')
  assert.equal(attrs['gen_ai.system'], 'deepseek')
  assert.equal(attrs['gen_ai.operation.name'], 'chat')
  assert.equal(attrs['gen_ai.agent.name'], 'deepjit')
  assert.equal(attrs['gen_ai.request.model'], 'deepseek-v4-flash')
  assert.equal('gen_ai.request.temperature' in attrs, false)
  assert.equal('gen_ai.request.max_tokens' in attrs, false)
})

test('genai: llmSpanAttributes honors explicit provider/operation and optional knobs', () => {
  const attrs = llmSpanAttributes({ model: 'm', system: 'openai', operation: 'execute_tool', temperature: 0.5, maxTokens: 32 })
  assert.equal(attrs['gen_ai.provider.name'], 'openai')
  assert.equal(attrs['gen_ai.system'], 'openai')
  assert.equal(attrs['gen_ai.operation.name'], 'execute_tool')
  assert.equal(attrs['gen_ai.request.temperature'], 0.5)
  assert.equal(attrs['gen_ai.request.max_tokens'], 32)
})
