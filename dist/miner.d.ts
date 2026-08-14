import { DeepJitStore } from './store.ts';
export interface MinerConfig {
    ngramMin: number;
    ngramMax: number;
    maxRows?: number;
}
/** Extract intent keywords: ASCII words + CJK bigrams, stopword filtered. */
export declare function extractKeywords(text: string, maxPerText?: number): string[];
/**
 * Incremental hot-path mining: per-session tool-sequence n-grams and intent
 * keywords, aggregated across sessions into the patterns table.
 */
export declare function mineHotPatterns(store: DeepJitStore, cfg: MinerConfig): void;
