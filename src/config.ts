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
  argumentAware: boolean
  compileCandidates: number
  topK: number
  minFlowSteps: number
  minPatternValue: number
  skillDir: string
  flowDir: string
  feedbackMode: 'auto' | 'runtime'
  dryRun: boolean
  locale: 'auto' | 'en' | 'zh'
  gcEnabled: boolean
  gcStaleMs: number
  gcProtectMs: number
  traceRetentionMs: number
  patternRetentionMs: number
  deoptMinUses: number
  deoptMaxSuccessRate: number
  qualityMinUses: number
  minQuality: number
  promoteMinUses: number
  promoteMinSuccessRate: number
  stepTimeoutMs: number
  flowTimeoutMs: number
}

export const Config: Schema<DeepJitConfig> = Schema.object({
  enabled: Schema.boolean().default(true),
  dbPath: Schema.string().default(''),
  flushIntervalMs: Schema.number().min(1).default(200),
  flushBatchSize: Schema.number().min(1).default(200),
  maxResultChars: Schema.number().min(0).default(4000),
  maxPendingCalls: Schema.number().min(1).default(10_000),
  minerMaxRows: Schema.number().min(1).default(20_000),
  transcriptMaxRows: Schema.number().min(1).default(2000),
  summarizeIntervalMs: Schema.number().min(1).default(10 * 60 * 1000),
  minIntervalMs: Schema.number().min(0).default(5 * 60 * 1000),
  llmProvider: Schema.string().default('deepseek-official'),
  llmModel: Schema.string().default(''),
  minRepeat: Schema.number().min(1).default(3),
  ngramMin: Schema.number().min(1).default(2),
  ngramMax: Schema.number().min(1).default(4),
  argumentAware: Schema.boolean().default(false),
  compileCandidates: Schema.number().min(1).default(1),
  topK: Schema.number().min(1).default(5),
  minFlowSteps: Schema.number().min(1).default(2),
  minPatternValue: Schema.number().min(0).default(6),
  skillDir: Schema.string().default(''),
  flowDir: Schema.string().default(''),
  feedbackMode: Schema.union(['auto', 'runtime']).default('auto'),
  dryRun: Schema.boolean().default(false),
  locale: Schema.union(['auto', 'en', 'zh']).default('auto'),
  gcEnabled: Schema.boolean().default(true),
  gcStaleMs: Schema.number().min(0).default(14 * 24 * 3600 * 1000),
  gcProtectMs: Schema.number().min(0).default(24 * 3600 * 1000),
  traceRetentionMs: Schema.number().min(0).default(7 * 24 * 3600 * 1000),
  patternRetentionMs: Schema.number().min(0).default(7 * 24 * 3600 * 1000),
  deoptMinUses: Schema.number().min(1).default(5),
  deoptMaxSuccessRate: Schema.number().min(0).max(1).default(0.5),
  qualityMinUses: Schema.number().min(1).default(5),
  minQuality: Schema.number().min(0).default(0),
  promoteMinUses: Schema.number().min(1).default(5),
  promoteMinSuccessRate: Schema.number().min(0).max(1).default(0.8),
  stepTimeoutMs: Schema.number().min(1).default(120_000),
  flowTimeoutMs: Schema.number().min(0).default(600_000),
})
