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

/** R2 production plane: Household commands are complete; later mutation families remain disabled. */
export const PRODUCTION_R2_CAPABILITIES: ProductCapabilities = Object.freeze({
  householdMutations: true,
  expenseMutations: false,
  settlementMutations: false,
  cardMutations: false,
  receiptMutations: false,
  receiptContentReads: false,
  profileMutations: false,
});

/** R3B production plane: Cards are complete; financial Household writes remain gated. */
export const PRODUCTION_R3_CARD_CAPABILITIES: ProductCapabilities = Object.freeze({
  ...PRODUCTION_R2_CAPABILITIES,
  cardMutations: true,
});

/** R3C/D production plane: Cards and Expenses are complete; Settlement writes remain gated. */
export const PRODUCTION_R3_EXPENSE_CAPABILITIES: ProductCapabilities = Object.freeze({
  ...PRODUCTION_R3_CARD_CAPABILITIES,
  expenseMutations: true,
});

/** R3E production plane: all approved financial commands are complete; R4 Receipt actions remain gated. */
export const PRODUCTION_R3_CAPABILITIES: ProductCapabilities = Object.freeze({
  ...PRODUCTION_R3_EXPENSE_CAPABILITIES,
  settlementMutations: true,
});

/** R4A: authorized server-delivered Receipt binaries are available; writes remain gated. */
export const PRODUCTION_R4_CONTENT_CAPABILITIES: ProductCapabilities = Object.freeze({
  ...PRODUCTION_R3_CAPABILITIES,
  receiptContentReads: true,
});

/** R4: trusted upload/removal sagas and private content delivery are complete. */
export const PRODUCTION_R4_CAPABILITIES: ProductCapabilities = Object.freeze({
  ...PRODUCTION_R4_CONTENT_CAPABILITIES,
  receiptMutations: true,
  profileMutations: true,
});
