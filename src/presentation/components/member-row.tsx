import { cn } from "@/lib/utils";
import { MemberAvatar } from "./member-avatar";

interface MemberRowProps extends React.ComponentProps<"div"> {
  readonly displayName: string;
  readonly secondaryText?: string;
  readonly trailing?: React.ReactNode;
  readonly compact?: boolean;
}

export function MemberRow({
  displayName,
  secondaryText,
  trailing,
  compact = false,
  className,
  ...props
}: MemberRowProps) {
  return (
    <div
      className={cn("flex min-w-0 items-center", compact ? "justify-center gap-0" : "gap-3", className)}
      data-slot="member-row"
      {...props}
    >
      <MemberAvatar displayName={displayName} />
      <div
        aria-hidden={compact}
        className={cn(
          "min-w-0 flex-1 overflow-hidden transition-[max-width,opacity] duration-300 ease-[var(--motion-ease-out)]",
          compact ? "max-w-0 opacity-0" : "max-w-48 opacity-100",
        )}
      >
        <p className="truncate text-sm font-medium">{displayName}</p>
        {secondaryText ? (
          <p className="truncate text-caption text-text-muted">{secondaryText}</p>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
