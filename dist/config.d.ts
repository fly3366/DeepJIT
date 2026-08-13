import Schema from '@deepseek-ai/schemastery';
export interface DeepJitConfig {
    enabled: boolean;
    dbPath: string;
    flushIntervalMs: number;
    flushBatchSize: number;
    maxResultChars: number;
    summarizeIntervalMs: number;
    minIntervalMs: number;
    llmProvider: string;
    llmModel: string;
    minRepeat: number;
    ngramMin: number;
    ngramMax: number;
    topK: number;
    skillDir: string;
    flowDir: string;
    feedbackMode: 'auto' | 'runtime';
    locale: 'auto' | 'en' | 'zh';
    stepTimeoutMs: number;
    flowTimeoutMs: number;
}
export declare const Config: Schema<DeepJitConfig>;
