import Schema from '@deepseek-ai/schemastery'

export interface DeepJitConfig {
  enabled: boolean
  dbPath: string
  flushIntervalMs: number
  flushBatchSize: number
  maxResultChars: number
  maxPendingCalls: number
  minerMaxRows: number
  transcriptMaxRows: number
  summarizeIntervalMs: number
  minIntervalMs: number
  llmProvider: string
  llmModel: string
  minRepeat: number
  ngramMin: number
  ngramMax: number
  topK: number
  minFlowSteps: number
  minPatternValue: number
  skillDir: string
  flowDir: string
  feedbackMode: 'auto' | 'runtime'
  locale: 'auto' | 'en' | 'zh'
  gcEnabled: boolean
  gcStaleMs: number
  gcProtectMs: number
  traceRetentionMs: number
  patternRetentionMs: number
  stepTimeoutMs: number
  flowTimeoutMs: number
}

export const Config: Schema<DeepJitConfig> = Schema.object({
  enabled: Schema.boolean().default(true),
  dbPath: Schema.string().default(''),
  flushIntervalMs: Schema.number().default(200),
  flushBatchSize: Schema.number().default(200),
  maxResultChars: Schema.number().default(4000),
  maxPendingCalls: Schema.number().default(10_000),
  minerMaxRows: Schema.number().default(20_000),
  transcriptMaxRows: Schema.number().default(2000),
  summarizeIntervalMs: Schema.number().default(10 * 60 * 1000),
  minIntervalMs: Schema.number().default(5 * 60 * 1000),
  llmProvider: Schema.string().default('deepseek-official'),
  llmModel: Schema.string().default(''),
  minRepeat: Schema.number().default(3),
  ngramMin: Schema.number().default(2),
  ngramMax: Schema.number().default(4),
  topK: Schema.number().default(5),
  minFlowSteps: Schema.number().default(2),
  minPatternValue: Schema.number().default(6),
  skillDir: Schema.string().default(''),
  flowDir: Schema.string().default(''),
  feedbackMode: Schema.union(['auto', 'runtime']).default('auto'),
  locale: Schema.union(['auto', 'en', 'zh']).default('auto'),
  gcEnabled: Schema.boolean().default(true),
  gcStaleMs: Schema.number().default(14 * 24 * 3600 * 1000),
  gcProtectMs: Schema.number().default(24 * 3600 * 1000),
  traceRetentionMs: Schema.number().default(7 * 24 * 3600 * 1000),
  patternRetentionMs: Schema.number().default(7 * 24 * 3600 * 1000),
  stepTimeoutMs: Schema.number().default(120_000),
  flowTimeoutMs: Schema.number().default(600_000),
})
