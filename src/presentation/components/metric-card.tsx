import { cn } from "@/lib/utils";
import { Surface } from "./surface";

interface MetricCardProps extends Omit<React.ComponentProps<typeof Surface>, "title"> {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly supportingText?: string;
  readonly icon?: React.ReactNode;
}

export function MetricCard({
  label,
  value,
  supportingText,
  icon,
  className,
  ...props
}: MetricCardProps) {
  return (
    <Surface className={cn("grid gap-4", className)} {...props}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-label text-text-secondary">{label}</p>
        {icon ? <span aria-hidden="true">{icon}</span> : null}
      </div>
      <div className="text-h2 font-semibold">{value}</div>
      {supportingText ? (
        <p className="text-caption text-text-muted">{supportingText}</p>
      ) : null}
    </Surface>
  );
}
