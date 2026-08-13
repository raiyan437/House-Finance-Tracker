import { cn } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "../components/status-badge";

interface FinancialStatusProps extends React.ComponentProps<"div"> {
  readonly label: string;
  readonly detail?: React.ReactNode;
  readonly tone?: StatusTone;
}

export function FinancialStatus({
  label,
  detail,
  tone = "neutral",
  className,
  ...props
}: FinancialStatusProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-slot="financial-status"
      {...props}
    >
      <StatusBadge tone={tone}>{label}</StatusBadge>
      {detail ? (
        <span className="text-caption text-text-secondary">{detail}</span>
      ) : null}
    </div>
  );
}
