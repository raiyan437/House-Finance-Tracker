import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface CardEmptyStateProps {
  readonly icon?: LucideIcon;
  readonly message: string;
  readonly children?: React.ReactNode;
  readonly className?: string;
}

export function CardEmptyState({ icon: Icon = Inbox, message, children, className }: CardEmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center gap-2 rounded-xl bg-secondary/60 px-4 py-5 text-center", className)}
      data-slot="card-empty-state"
    >
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-lg bg-background text-text-muted"
      >
        <Icon className="size-4" />
      </span>
      <p className="text-caption text-text-secondary">{message}</p>
      {children ? <div className="mt-1">{children}</div> : null}
    </div>
  );
}
