import Link from "next/link";
import { House } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandProps = Omit<React.ComponentProps<typeof Link>, "href">;

export function Brand({ className, ...props }: BrandProps) {
  return (
    <Link
      aria-label="House Finance Tracker dashboard"
      className={cn(
        "inline-flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        className,
      )}
      href="/dashboard"
      {...props}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand text-foreground">
        <House aria-hidden="true" className="size-5" strokeWidth={1.8} />
      </span>
      <span className="text-sm font-semibold leading-[1.15] tracking-[-0.01em]">
        House Finance
        <span className="block text-text-secondary">Tracker</span>
      </span>
    </Link>
  );
}
