/**
 * Typed production capability model (R1-9).
 *
 * The composition root reports honestly which product mutation families the
 * active backend can execute. Presentation disables unavailable actions with a
 * restrained explanation instead of letting them fail at runtime. Local mode
 * reports every capability as available; the R1 production read plane reports
 * every write family as unavailable.
 */
export interface ProductCapabilities {
  readonly householdMutations: boolean;
  readonly expenseMutations: boolean;
  readonly settlementMutations: boolean;
  readonly cardMutations: boolean;
  /** Metadata lifecycle writes (upload/delete). Binary reads are separate. */
  readonly receiptMutations: boolean;
  /** Reading stored receipt binaries (previews). */
  readonly receiptContentReads: boolean;
  readonly profileMutations: boolean;
}

export const FULL_LOCAL_CAPABILITIES: ProductCapabilities = Object.freeze({
  householdMutations: true,
  expenseMutations: true,
  settlementMutations: true,
  cardMutations: true,
  receiptMutations: true,
  receiptContentReads: true,
  profileMutations: true,
});

/** R1 production read plane: every source of truth readable, nothing writable yet (R2+ owns commands). */
export const PRODUCTION_READ_ONLY_CAPABILITIES: ProductCapabilities = Object.freeze({
  householdMutations: false,
  expenseMutations: false,
  settlementMutations: false,
  cardMutations: false,
  receiptMutations: false,
  receiptContentReads: false,
  profileMutations: false,
});
