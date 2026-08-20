import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingState } from "./async-state";
import { Surface } from "./surface";

type ChartCardState = "ready" | "loading" | "empty" | "error";

interface ChartCardProps extends Omit<React.ComponentProps<typeof Surface>, "title"> {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly state?: ChartCardState;
  readonly summary: string;
  readonly summaryVisuallyHidden?: boolean;
  readonly emptyMessage?: string;
  readonly errorMessage?: string;
  readonly onRetry?: () => void;
}

export function ChartCard({
  title,
  description,
  action,
  state = "ready",
  summary,
  summaryVisuallyHidden = false,
  emptyMessage = "There is no chart data to show yet.",
  errorMessage = "The chart could not be loaded.",
  onRetry,
  children,
  className,
  ...props
}: ChartCardProps) {
  return (
    <Surface className={cn("grid gap-5", className)} {...props}>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="dashboard-panel-title">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs text-text-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      {state === "loading" ? <LoadingState label={`Loading ${title}`} /> : null}
      {state === "empty" ? (
        <EmptyState description={emptyMessage} title="No data yet" />
      ) : null}
      {state === "error" ? (
        <ErrorState
          description={errorMessage}
          onRetry={onRetry}
          title="Chart unavailable"
        />
      ) : null}
      {state === "ready" ? <div data-slot="chart-content">{children}</div> : null}
      <p
        className={cn(
          "border-t pt-4 text-caption text-text-secondary",
          summaryVisuallyHidden && "sr-only",
        )}
        data-slot="chart-summary"
      >
        <span className="font-medium text-foreground">Summary: </span>
        {summary}
      </p>
    </Surface>
  );
}
