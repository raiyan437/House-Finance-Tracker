import { type ExpenseFormValues } from "@/application/validation/expense-form.schema";
import type {
  ReceiptView,
  ExpenseView,
} from "@/application/services/application-services";
import { formatCanonicalBdt } from "@/domain/money/poisha";

import { formatBasisPoints } from "./expense-ui";

export const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"];

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export interface PendingReceipt {
  readonly key: string;
  readonly file: File;
  readonly url: string;
}

export interface ExistingReceiptPreview {
  readonly metadata: ReceiptView;
  readonly url?: string;
  readonly error?: boolean;
  readonly contentPending?: boolean;
}

export function definedTextRecord(
  values: Readonly<Record<string, string | undefined>> | undefined,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export const emptyValues: ExpenseFormValues = {
  name: "",
  iconCategory: "others",
  amountText: "",
  expenseDateText: "",
  paymentMethod: "cash",
  selectedCardId: "",
  participantIds: [],
  splitMethod: "equal",
  amountTextByParticipant: {},
  percentageTextByParticipant: {},
};

export function editFormValues(
  view: ExpenseView,
  name = view.expense.name,
): ExpenseFormValues {
  return {
    name,
    iconCategory: view.expense.iconCategory ?? "others",
    amountText: formatCanonicalBdt(view.expense.amount),
    expenseDateText: view.expense.expenseDate,
    paymentMethod: view.expense.payment.method,
    selectedCardId: view.privateCardSnapshot?.cardId ?? "",
    participantIds: view.expense.allocations.map(
      (allocation) => allocation.participantId,
    ),
    splitMethod: view.expense.splitMethod,
    amountTextByParticipant: Object.fromEntries(
      view.expense.allocations.map((allocation) => [
        allocation.participantId,
        formatCanonicalBdt(allocation.share),
      ]),
    ),
    percentageTextByParticipant: Object.fromEntries(
      (view.expense.percentageEntries ?? []).map((entry) => [
        entry.participantId,
        formatBasisPoints(entry.basisPoints),
      ]),
    ),
  };
}
