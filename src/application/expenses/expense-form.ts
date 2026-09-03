import {
  DomainError,
  allocateAmountSplit,
  allocateEqualSplit,
  basisPoints,
  expenseDate,
  parseBdtToPoisha,
  parsePercentageToBasisPoints,
  poisha,
  positivePoisha,
  summarizeAmountSplit,
  summarizePercentageSplitDraft,
  userId,
  type ExpenseDate,
  type ExpenseIconCategory,
  type Poisha,
  type PercentageSplitEntry,
  type PositivePoisha,
  type SplitAllocation,
  type SplitMethod,
  type UserId,
} from "@/domain";

export interface ExpenseFormDraft {
  readonly name: string;
  readonly iconCategory?: ExpenseIconCategory;
  readonly amountText: string;
  readonly expenseDateText: string;
  readonly paymentMethod: "cash" | "card";
  readonly selectedCardId?: string;
  readonly participantIds: readonly string[];
  readonly splitMethod: SplitMethod;
  readonly amountTextByParticipant: Readonly<Record<string, string>>;
  readonly percentageTextByParticipant: Readonly<Record<string, string>>;
}

export type ExpenseDraftIssueField =
  | "name"
  | "amountText"
  | "expenseDateText"
  | "paymentMethod"
  | "participants"
  | "split";

export interface ExpenseDraftPreview {
  readonly status: "invalid" | "incomplete" | "over" | "ready";
  readonly issues: Readonly<Partial<Record<ExpenseDraftIssueField | string, string>>>;
  readonly amount?: PositivePoisha;
  readonly allocated?: Poisha;
  readonly remaining?: Poisha;
  readonly totalBasisPoints?: number;
  readonly remainingBasisPoints?: number;
  readonly provisional: boolean;
  readonly allocations: readonly SplitAllocation[];
  readonly participantCount: number;
  readonly yourShare: Poisha;
  readonly canPersist: boolean;
}

export interface PreparedExpenseDraft {
  readonly name: string;
  readonly iconCategory: ExpenseIconCategory;
  readonly amount: PositivePoisha;
  readonly expenseDate: ExpenseDate;
  readonly splitMethod: SplitMethod;
  readonly allocations: readonly SplitAllocation[];
  readonly participantIds: readonly UserId[];
  readonly percentageEntries?: readonly PercentageSplitEntry[];
}

function message(error: unknown, fallback: string): string {
  return error instanceof DomainError ? error.message : fallback;
}

function parsePercentageEntries(
  participants: readonly UserId[],
  values: Readonly<Record<string, string>>,
): readonly PercentageSplitEntry[] {
  return participants.map((participantId) => ({
    participantId,
    basisPoints: basisPoints(
      parsePercentageToBasisPoints(values[participantId] ?? ""),
    ),
  }));
}

export function previewExpenseDraft(
  draft: ExpenseFormDraft,
  currentUserId?: string,
): ExpenseDraftPreview {
  const issues: Partial<Record<ExpenseDraftIssueField | string, string>> = {};
  let amount: PositivePoisha | undefined;
  let participants: readonly UserId[] = [];

  if (!draft.name.trim()) issues.name = "Expense Name is required.";
  try {
    amount = positivePoisha(parseBdtToPoisha(draft.amountText));
  } catch (error) {
    issues.amountText = message(error, "Enter a valid positive BDT amount.");
  }
  try {
    expenseDate(draft.expenseDateText);
  } catch (error) {
    issues.expenseDateText = message(error, "Enter a valid Expense Date.");
  }
  try {
    participants = draft.participantIds.map(userId);
    if (new Set(participants).size !== participants.length || participants.length === 0) {
      throw new DomainError("NO_PARTICIPANTS", "Select at least one participant.");
    }
  } catch (error) {
    issues.participants = message(error, "Select at least one participant.");
  }

  const basePreview = {
    issues,
    participantCount: participants.length,
    yourShare: poisha(0),
    provisional: false,
    allocations: [] as readonly SplitAllocation[],
    canPersist: false,
  };
  if (!amount || issues.participants) {
    return { status: "invalid", ...basePreview, ...(amount ? { amount } : {}) };
  }

  try {
    let allocations: readonly SplitAllocation[];
    let allocated: Poisha;
    let remaining: Poisha;
    let provisional = false;
    let totalBasisPoints: number | undefined;
    let remainingBasisPoints: number | undefined;
    let status: ExpenseDraftPreview["status"] = "ready";

    if (draft.splitMethod === "equal") {
      allocations = allocateEqualSplit(amount, participants);
      allocated = poisha(amount);
      remaining = poisha(0);
    } else if (draft.splitMethod === "amount") {
      const entries = participants.map((participantId) => {
        const raw = draft.amountTextByParticipant[participantId];
        if (raw === undefined || raw === "") {
          issues[`amount:${participantId}`] = "Enter an amount, including 0 for a zero share.";
          return { participantId, amount: poisha(0) };
        }
        try {
          return { participantId, amount: parseBdtToPoisha(raw) };
        } catch (error) {
          issues[`amount:${participantId}`] = message(error, "Enter a valid amount.");
          return { participantId, amount: poisha(0) };
        }
      });
      const summary = summarizeAmountSplit(amount, participants, entries);
      allocated = summary.allocatedTotal;
      remaining = summary.remaining;
      if (Object.keys(issues).some((key) => key.startsWith("amount:"))) {
        status = "invalid";
        allocations = summary.allocations;
      } else if (summary.remaining < 0) {
        status = "over";
        allocations = summary.allocations;
        issues.split = "Allocated amounts exceed the Expense Total.";
      } else if (!summary.isExact) {
        status = "incomplete";
        allocations = summary.allocations;
        issues.split = "Allocated amounts must equal the Expense Total exactly.";
      } else {
        allocations = allocateAmountSplit(amount, participants, entries);
      }
    } else {
      const entries = participants.map((participantId) => {
        const raw = draft.percentageTextByParticipant[participantId];
        if (raw === undefined || raw === "") {
          issues[`percentage:${participantId}`] = "Enter a percentage, including 0 for a zero share.";
          return { participantId, basisPoints: basisPoints(0) };
        }
        try {
          return {
            participantId,
            basisPoints: basisPoints(parsePercentageToBasisPoints(raw)),
          };
        } catch (error) {
          issues[`percentage:${participantId}`] = message(error, "Enter a valid percentage.");
          return { participantId, basisPoints: basisPoints(0) };
        }
      });
      if (Object.keys(issues).some((key) => key.startsWith("percentage:"))) {
        return { status: "invalid", ...basePreview, amount, issues };
      }
      const summary = summarizePercentageSplitDraft(amount, participants, entries);
      allocations = summary.allocations;
      allocated = summary.allocatedTotal;
      remaining = summary.remainingAmount;
      provisional = summary.provisional;
      totalBasisPoints = summary.totalBasisPoints;
      remainingBasisPoints = summary.remainingBasisPoints;
      if (!summary.isExact) {
        status = "incomplete";
        issues.split = "Percentages must total exactly 100%.";
      }
    }

    const hasBaseIssue = Boolean(issues.name || issues.amountText || issues.expenseDateText || issues.participants);
    const canPersist = status === "ready" && !hasBaseIssue;
    const current = currentUserId ? userId(currentUserId) : undefined;
    return {
      status: hasBaseIssue && status === "ready" ? "invalid" : status,
      issues,
      amount,
      allocated,
      remaining,
      ...(totalBasisPoints === undefined ? {} : { totalBasisPoints }),
      ...(remainingBasisPoints === undefined ? {} : { remainingBasisPoints }),
      provisional,
      allocations,
      participantCount: participants.length,
      yourShare: current
        ? allocations.find((allocation) => allocation.participantId === current)?.share ?? poisha(0)
        : poisha(0),
      canPersist,
    };
  } catch (error) {
    issues.split = message(error, "The split is invalid.");
    return { status: "over", ...basePreview, amount, issues };
  }
}

export function prepareExpenseDraft(
  draft: ExpenseFormDraft,
  currentUserId?: string,
): PreparedExpenseDraft {
  const preview = previewExpenseDraft(draft, currentUserId);
  if (!preview.canPersist || !preview.amount) {
    throw new DomainError("INVALID_EXPENSE", "The expense form is not ready to save.");
  }
  return {
    name: draft.name.trim(),
    iconCategory: draft.iconCategory ?? "others",
    amount: preview.amount,
    expenseDate: expenseDate(draft.expenseDateText),
    splitMethod: draft.splitMethod,
    allocations: preview.allocations,
    participantIds: draft.participantIds.map(userId),
    ...(draft.splitMethod === "percentage"
      ? {
          percentageEntries: parsePercentageEntries(
            draft.participantIds.map(userId),
            draft.percentageTextByParticipant,
          ),
        }
      : {}),
  };
}
