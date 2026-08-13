import {
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "success" | "danger" | "warning" | "info";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border-strong bg-secondary text-text-secondary",
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-foreground",
  info: "bg-info-soft text-info",
};

const toneIcons: Partial<Record<StatusTone, LucideIcon>> = {
  success: CircleCheck,
  danger: CircleX,
  warning: TriangleAlert,
  info: Info,
};

interface StatusBadgeProps extends React.ComponentProps<typeof Badge> {
  readonly tone?: StatusTone;
}

export function StatusBadge({
  tone = "neutral",
  className,
  children,
  ...props
}: StatusBadgeProps) {
  const Icon = toneIcons[tone];

  return (
    <Badge
      className={cn(toneClasses[tone], className)}
      variant="outline"
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </Badge>
  );
}
