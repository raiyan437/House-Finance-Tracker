import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EXPENSE_ICON_OPTIONS } from "@/presentation/expenses/expense-icon";
import { StandalonePage } from "@/presentation/shell/standalone-page";

export default function CreditsPage() {
  return (
    <StandalonePage title="Icon Credits" description="Expense category icons are from Flaticon and used under the free license with attribution." action={<Button asChild><Link href="/dashboard" prefetch={false}>Back to Dashboard</Link></Button>}>
      <div className="journey-credits-list">
        {EXPENSE_ICON_OPTIONS.map(({ value, label, author, sourceUrl }) => (
          <a href={sourceUrl} key={value} rel="noreferrer" target="_blank"><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs text-text-secondary">by {author} · Flaticon</span></a>
        ))}
      </div>
    </StandalonePage>
  );
}
