import { CircleCheck, CircleX } from "lucide-react";

type ExpenseSettlementStatus = "settled" | "unsettled";

export function ExpenseSettlementStatusIndicator({
  status,
}: Readonly<{
  status: ExpenseSettlementStatus;
}>) {
  const settled = status === "settled";
  const label = settled ? "Settled" : "Unsettled";
  const Icon = settled ? CircleCheck : CircleX;

  return (
    <span
      aria-label={label}
      className={`inline-flex size-5 shrink-0 items-center justify-center ${settled ? "text-success" : "text-danger"}`}
      role="img"
      title={label}
    >
      <Icon aria-hidden="true" className="size-[18px]" />
    </span>
  );
}
