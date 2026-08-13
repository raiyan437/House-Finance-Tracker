import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const surfaceVariants = cva("border bg-card text-card-foreground", {
  variants: {
    radius: {
      small: "rounded-lg",
      default: "rounded-xl",
      card: "rounded-[var(--radius-card)]",
      feature: "rounded-2xl",
    },
    elevation: {
      none: "shadow-none",
      small: "shadow-[var(--shadow-small)]",
      card: "shadow-[var(--shadow-card)]",
    },
    padding: {
      none: "p-0",
      small: "p-4",
      default: "p-5 md:p-6",
      large: "p-6 md:p-8",
    },
  },
  defaultVariants: {
    radius: "card",
    elevation: "none",
    padding: "default",
  },
});

type SurfaceProps = React.ComponentProps<"section"> &
  VariantProps<typeof surfaceVariants>;

export function Surface({
  className,
  radius,
  elevation,
  padding,
  ...props
}: SurfaceProps) {
  return (
    <section
      className={cn(
        surfaceVariants({ radius, elevation, padding }),
        className,
      )}
      data-slot="surface"
      {...props}
    />
  );
}

export { surfaceVariants };
