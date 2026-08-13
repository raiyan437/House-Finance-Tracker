import { cn } from "@/lib/utils";
import { MemberAvatar } from "./member-avatar";

interface MemberRowProps extends React.ComponentProps<"div"> {
  readonly displayName: string;
  readonly secondaryText?: string;
  readonly trailing?: React.ReactNode;
}

export function MemberRow({
  displayName,
  secondaryText,
  trailing,
  className,
  ...props
}: MemberRowProps) {
  return (
    <div
      className={cn("flex min-w-0 items-center gap-3", className)}
      data-slot="member-row"
      {...props}
    >
      <MemberAvatar displayName={displayName} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        {secondaryText ? (
          <p className="truncate text-caption text-text-muted">{secondaryText}</p>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
