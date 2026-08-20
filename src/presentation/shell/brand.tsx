import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandProps = Omit<React.ComponentProps<typeof Link>, "href">;

export function Brand({ className, ...props }: BrandProps) {
  return (
    <Link
      aria-label="House Finance Tracker dashboard"
      className={cn(
        "inline-flex items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        className,
      )}
      href="/dashboard"
      {...props}
    >
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-foreground text-lg font-semibold text-white">
        H
      </span>
      <span className="text-[15px] font-semibold leading-[1.15] tracking-[-0.01em]">
        House Finance
        <span className="mt-0.5 block text-xs font-normal text-text-muted">Tracker</span>
      </span>
    </Link>
  );
}
