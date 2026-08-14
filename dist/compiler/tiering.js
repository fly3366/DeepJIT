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
export function runTiering(store, cfg) {
    const deopted = [];
    for (const row of store.listDeoptCandidates(cfg.deoptMinUses, cfg.deoptMaxSuccessRate)) {
        store.updateArtifactStatus(row.name, 'disabled');
        deopted.push(row.name);
    }
    const promote = store.listPromoteCandidates(cfg.promoteMinUses, cfg.promoteMinSuccessRate);
    return { deopted, promote };
}
//# sourceMappingURL=tiering.js.map