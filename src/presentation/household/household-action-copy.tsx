import type {
  HouseholdActionBlocker,
  HouseholdActionPreview,
} from "@/application/household/household-page";
import { poisha } from "@/domain/money/poisha";
import { formatBdt } from "@/presentation/finance/format-bdt";

function absoluteAmount(blocker: HouseholdActionBlocker): string {
  const amount = blocker.amount ?? poisha(0);
  const absolute = amount < 0 ? poisha(Number(-BigInt(amount))) : amount;
  return formatBdt(absolute);
}

export function householdBlockerText(
  blocker: HouseholdActionBlocker,
  targetName?: string,
): string {
  switch (blocker.code) {
    case "OWES_BALANCE":
      return `You currently owe ${absoluteAmount(blocker)}. Settle your outstanding balance before leaving.`;
    case "IS_OWED_BALANCE":
      return `You are currently owed ${absoluteAmount(blocker)}. Settle the outstanding balance before leaving.`;
    case "OUTGOING_PENDING_SETTLEMENT":
      return "A payment you marked as paid is still pending. Resolve it before leaving.";
    case "INCOMING_PENDING_SETTLEMENT":
      return "A payment to you is still pending. Resolve it before leaving.";
    case "LEADERSHIP_TRANSFER_REQUIRED":
      return "Transfer leadership to another active member before leaving.";
    case "HOUSEHOLD_DELETE_REQUIRED":
      return "A sole remaining Leader cannot leave. Delete the household to exit.";
    case "TARGET_OWES_BALANCE":
      return `${targetName ?? "This member"} currently owes ${absoluteAmount(blocker)}.`;
    case "TARGET_IS_OWED_BALANCE":
      return `${targetName ?? "This member"} is currently owed ${absoluteAmount(blocker)}.`;
    case "TARGET_OUTGOING_PENDING_SETTLEMENT":
      return `${targetName ?? "This member"} has an outgoing Pending settlement.`;
    case "TARGET_INCOMING_PENDING_SETTLEMENT":
      return `${targetName ?? "This member"} has an incoming Pending settlement.`;
    case "HOUSEHOLD_LEDGER_NOT_ZERO":
      return "The full household ledger must be settled before deletion.";
    case "HOUSEHOLD_HAS_PENDING_SETTLEMENT":
      return "Resolve every Pending settlement before deleting the household.";
  }
}

export function HouseholdActionExplanations({
  preview,
  targetName,
}: Readonly<{
  preview: HouseholdActionPreview;
  targetName?: string;
}>) {
  if (preview.blockers.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1 text-sm text-text-secondary">
      {preview.blockers.map((blocker) => (
        <li key={blocker.code}>{householdBlockerText(blocker, targetName)}</li>
      ))}
    </ul>
  );
}
