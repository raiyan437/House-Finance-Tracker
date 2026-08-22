import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandProps = Omit<React.ComponentProps<typeof Link>, "href">;

interface BrandPropsWithState extends BrandProps {
  readonly compact?: boolean;
}

export function Brand({ className, compact = false, ...props }: BrandPropsWithState) {
  return (
    <Link
      aria-label="House Finance Tracker dashboard"
      className={cn(
        "inline-flex min-w-0 items-center rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 transition-[gap] duration-300 ease-[var(--motion-ease-out)]",
        compact ? "gap-0" : "gap-3",
        className,
      )}
      href="/dashboard"
      {...props}
    >
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-foreground text-lg font-semibold text-white">
        H
      </span>
      <span
        aria-hidden={compact}
        className={cn(
          "min-w-0 overflow-hidden text-[15px] font-semibold leading-[1.15] tracking-[-0.01em] transition-[max-width,opacity,transform] duration-300 ease-[var(--motion-ease-out)]",
          compact
            ? "max-w-0 -translate-x-2 opacity-0"
            : "max-w-40 translate-x-0 opacity-100",
        )}
      >
        House Finance
        <span className="mt-0.5 block text-xs font-normal text-text-muted">Tracker</span>
      </span>
    </Link>
  );
}
