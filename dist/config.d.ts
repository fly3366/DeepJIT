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
    minFlowSteps: number;
    minPatternValue: number;
    skillDir: string;
    flowDir: string;
    feedbackMode: 'auto' | 'runtime';
    locale: 'auto' | 'en' | 'zh';
    gcEnabled: boolean;
    gcStaleMs: number;
    gcProtectMs: number;
    stepTimeoutMs: number;
    flowTimeoutMs: number;
}
export declare const Config: Schema<DeepJitConfig>;
