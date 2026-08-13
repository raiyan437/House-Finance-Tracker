import { cn } from "@/lib/utils";

export function PageContainer({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[var(--content-max)] p-4 md:p-5 lg:p-6 xl:p-8",
        className,
      )}
      data-slot="page-container"
      {...props}
    />
  );
}
