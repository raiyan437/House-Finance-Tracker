import Link from "next/link";
import Image from "next/image";
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
      prefetch={false}
      {...props}
    >
      <Image
        alt=""
        aria-hidden="true"
        className="size-10 shrink-0 rounded-[12px]"
        height={40}
        priority
        src="/house-finance-logo.png"
        width={40}
      />
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
