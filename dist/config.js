import Schema from '@deepseek-ai/schemastery';
export const Config = Schema.object({
    enabled: Schema.boolean().default(true),
    dbPath: Schema.string().default(''),
    flushIntervalMs: Schema.number().default(200),
    flushBatchSize: Schema.number().default(200),
    maxResultChars: Schema.number().default(4000),
    summarizeIntervalMs: Schema.number().default(10 * 60 * 1000),
    minIntervalMs: Schema.number().default(5 * 60 * 1000),
    llmProvider: Schema.string().default('deepseek-official'),
    llmModel: Schema.string().default(''),
    minRepeat: Schema.number().default(3),
    ngramMin: Schema.number().default(2),
    ngramMax: Schema.number().default(4),
    topK: Schema.number().default(5),
    skillDir: Schema.string().default(''),
    flowDir: Schema.string().default(''),
    feedbackMode: Schema.union(['auto', 'runtime']).default('auto'),
    locale: Schema.union(['auto', 'en', 'zh']).default('auto'),
    stepTimeoutMs: Schema.number().default(120_000),
    flowTimeoutMs: Schema.number().default(600_000),
});
//# sourceMappingURL=config.js.map