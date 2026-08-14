/**
 * Compiler "tiering" pass: promotion and deoptimization of compiled artifacts,
 * mirroring a JIT's tiered compilation (baseline skill -> optimized flow) and
 * its deopt fallback when optimized code proves unreliable.
 *
 * - Deoptimization: an active flow used enough but failing too often is
 *   disabled, handing control back to the agent's own planning.
 * - Promotion: an active skill used often and reliably is returned to the
 *   caller so its source pattern can be recompiled as a flow (tier 2).
 */
import type { DeepJitStore, ArtifactRow } from '../store.ts';
export interface TieringConfig {
    deoptMinUses: number;
    deoptMaxSuccessRate: number;
    promoteMinUses: number;
    promoteMinSuccessRate: number;
}
export interface TieringResult {
    deopted: string[];
    promote: ArtifactRow[];
}
export declare function runTiering(store: DeepJitStore, cfg: TieringConfig): TieringResult;
