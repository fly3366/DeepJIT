import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startLlmSpan, endLlmSpan, llmSpanAttributes } from '../src/genai.ts'

test('genai: start/end span with usage and error do not throw (no-op without provider)', () => {
  const span = startLlmSpan({ model: 'deepseek-v4-flash', temperature: 0.2, maxTokens: 100 })
  assert.equal(typeof span.setAttribute, 'function')
  assert.equal(typeof span.end, 'function')
  endLlmSpan(span, { inputTokens: 10, outputTokens: 5 })

  const errSpan = startLlmSpan({ model: 'm' })
  endLlmSpan(errSpan, undefined, new Error('boom'))
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
