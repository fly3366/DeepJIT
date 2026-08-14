import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startLlmSpan, endLlmSpan } from '../src/genai.ts'

test('genai: start/end span with usage and error do not throw (no-op without provider)', () => {
  const span = startLlmSpan({ model: 'deepseek-v4-flash', temperature: 0.2, maxTokens: 100 })
  assert.equal(typeof span.setAttribute, 'function')
  assert.equal(typeof span.end, 'function')
  endLlmSpan(span, { inputTokens: 10, outputTokens: 5 })

  const errSpan = startLlmSpan({ model: 'm' })
  endLlmSpan(errSpan, undefined, new Error('boom'))
})
