import {
  CircleAlert,
  Inbox,
  LoaderCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Surface } from "./surface";

interface StateFrameProps extends React.ComponentProps<typeof Surface> {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly action?: React.ReactNode;
}

function StateFrame({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: StateFrameProps) {
  return (
    <Surface
      className={cn("flex min-h-64 flex-col items-center justify-center text-center", className)}
      {...props}
    >
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-secondary text-text-secondary">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="text-h3">{title}</h2>
      <p className="mt-2 max-w-md text-body text-text-secondary">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </Surface>
  );
}

interface EmptyStateProps extends Omit<StateFrameProps, "icon"> {
  readonly icon?: LucideIcon;
}

export function EmptyState({ icon = Inbox, ...props }: EmptyStateProps) {
  return <StateFrame icon={icon} data-slot="empty-state" {...props} />;
}

interface ErrorStateProps extends Omit<StateFrameProps, "icon" | "action"> {
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

export function ErrorState({
  onRetry,
  retryLabel = "Try again",
  ...props
}: ErrorStateProps) {
  return (
    <StateFrame
      action={
        onRetry ? <Button onClick={onRetry}>{retryLabel}</Button> : undefined
      }
      icon={CircleAlert}
      role="alert"
      data-slot="error-state"
      {...props}
    />
  );
}

interface LoadingStateProps extends React.ComponentProps<"div"> {
  readonly label?: string;
}

export function LoadingState({
  label = "Loading",
  className,
  ...props
}: LoadingStateProps) {
  return (
    <div
      aria-label={label}
      aria-live="polite"
      className={cn("grid gap-4", className)}
      data-slot="loading-state"
      role="status"
      {...props}
    >
      <span className="sr-only">{label}</span>
      <div className="flex items-center gap-3">
        <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-text-muted" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className="h-32 w-full rounded-[var(--radius-card)]" />
    </div>
  );
}
