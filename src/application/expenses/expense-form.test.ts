import { describe, expect, it } from "vitest";
import { previewExpenseDraft, prepareExpenseDraft, type ExpenseFormDraft } from "./expense-form";

const base: ExpenseFormDraft = {
  name: "Groceries",
  amountText: "100.01",
  expenseDateText: "2026-08-13",
  paymentMethod: "cash",
  participantIds: ["user-b", "user-a", "user-c"],
  splitMethod: "equal",
  amountTextByParticipant: {},
  percentageTextByParticipant: {},
};

describe("expense form financial preparation", () => {
  it("returns canonical equal allocations and retains zero shares", () => {
    const preview = previewExpenseDraft(
      { ...base, amountText: "0.01" },
      "user-c",
    );
    expect(preview.canPersist).toBe(true);
    expect(preview.allocations).toEqual([
      { participantId: "user-a", share: 1 },
      { participantId: "user-b", share: 0 },
      { participantId: "user-c", share: 0 },
    ]);
    expect(preview.yourShare).toBe(0);
  });

  it("shows exact amount under, over, and ready states", () => {
    const amountDraft = {
      ...base,
      splitMethod: "amount" as const,
      amountTextByParticipant: {
        "user-a": "40.00",
        "user-b": "30.00",
        "user-c": "30.00",
      },
    };
    expect(previewExpenseDraft(amountDraft)).toMatchObject({
      status: "incomplete",
      allocated: 10_000,
      remaining: 1,
      canPersist: false,
    });
    expect(
      previewExpenseDraft({
        ...amountDraft,
        amountTextByParticipant: { ...amountDraft.amountTextByParticipant, "user-c": "30.02" },
      }),
    ).toMatchObject({ status: "over", allocated: 10_002, remaining: -1 });
    expect(
      previewExpenseDraft({
        ...amountDraft,
        amountTextByParticipant: { ...amountDraft.amountTextByParticipant, "user-c": "30.01" },
      }),
    ).toMatchObject({ status: "ready", allocated: 10_001, remaining: 0, canPersist: true });
  });

  it("shows provisional percentages only below 100 and canonical shares at 100", () => {
    const percentageDraft = {
      ...base,
      amountText: "0.01",
      splitMethod: "percentage" as const,
      percentageTextByParticipant: {
        "user-a": "33.33",
        "user-b": "33.33",
        "user-c": "0",
      },
    };
    expect(previewExpenseDraft(percentageDraft)).toMatchObject({
      status: "incomplete",
      provisional: true,
      totalBasisPoints: 6_666,
      canPersist: false,
    });
    const exact = previewExpenseDraft({
      ...percentageDraft,
      percentageTextByParticipant: {
        "user-a": "33.34",
        "user-b": "33.33",
        "user-c": "33.33",
      },
    });
    expect(exact).toMatchObject({ status: "ready", provisional: false, canPersist: true });
    expect(exact.allocations).toEqual([
      { participantId: "user-a", share: 1 },
      { participantId: "user-b", share: 0 },
      { participantId: "user-c", share: 0 },
    ]);
  });

  it("prefers validation instead of provisional output for invalid or over-100 percentages", () => {
    const invalid = previewExpenseDraft({
      ...base,
      splitMethod: "percentage",
      percentageTextByParticipant: {
        "user-a": "33.333",
        "user-b": "33.33",
        "user-c": "33.33",
      },
    });
    expect(invalid.status).toBe("invalid");
    expect(invalid.provisional).toBe(false);

    const over = previewExpenseDraft({
      ...base,
      splitMethod: "percentage",
      percentageTextByParticipant: {
        "user-a": "34",
        "user-b": "33.01",
        "user-c": "33",
      },
    });
    expect(over.status).toBe("over");
    expect(over.provisional).toBe(false);
  });

  it("uses strict text parsing and requires an explicit participant", () => {
    expect(previewExpenseDraft({ ...base, amountText: " 100.01" }).issues.amountText).toBeTruthy();
    expect(previewExpenseDraft({ ...base, participantIds: [] }).issues.participants).toBeTruthy();
    expect(() => prepareExpenseDraft({ ...base, participantIds: [] })).toThrow();
  });
});
