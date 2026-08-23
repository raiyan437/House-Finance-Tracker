"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileCollapseProps {
  readonly id: string;
  readonly sectionLabel: string;
  readonly className?: string;
  readonly children: React.ReactNode;
}

export function MobileCollapse({ id, sectionLabel, className, children }: MobileCollapseProps) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button
        type="button"
        aria-controls={id}
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${sectionLabel}`}
        className="absolute right-2 top-2 z-10 flex size-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 md:hidden"
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 transition-transform duration-200", open ? "" : "-rotate-90")}
        />
      </button>
      <div id={id} className={cn(className, !open && "max-md:hidden")} data-open={open} data-slot="mobile-collapse-body">
        {children}
      </div>
    </>
  );
}
