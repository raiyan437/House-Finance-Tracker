import { Banknote, CreditCard } from "lucide-react";
import type { PaymentMixResult } from "@/application/analytics/monthly-analytics";
import { formatBdt } from "@/presentation/finance/format-bdt";
import { formatBasisPointPercentage } from "./analytics-ui";

const methods = [
  { key: "cash", label: "Cash", icon: Banknote, background: "bg-secondary" },
  { key: "card", label: "Card", icon: CreditCard, background: "bg-brand-soft" },
] as const;

export function PaymentMixRows({ compact = false, mix }: Readonly<{ compact?: boolean; mix: PaymentMixResult }>) {
  const valueClassName = compact ? "flex flex-col items-end leading-4" : "text-right";
  return (
    <dl className="grid gap-3">
      {methods.map(({ key, label, icon: Icon, background }) => (
        <div className="grid grid-cols-[1fr_auto] items-center gap-2" key={key}>
          <dt className="flex items-center gap-2 text-xs"><span className={`flex size-6 items-center justify-center rounded-lg ${background}`}><Icon aria-hidden="true" className="size-3.5 text-text-secondary" /></span>{label}</dt>
          <dd className={`financial-numerals ${valueClassName}`}>
            <span className="text-sm font-semibold">{formatBdt(mix[key].amount)}</span>
            {mix[key].basisPoints === undefined ? null : <span className={compact ? "text-xs font-semibold text-text-secondary" : "ml-2 text-xs font-semibold"}>{formatBasisPointPercentage(mix[key].basisPoints)}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
