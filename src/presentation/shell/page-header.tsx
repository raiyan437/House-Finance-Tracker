import { cn } from "@/lib/utils";

interface PageHeaderProps extends React.ComponentProps<"header"> {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly headingLevel?: "h1" | "h2";
}

export function PageHeader({
  title,
  description,
  action,
  headingLevel = "h1",
  className,
  ...props
}: PageHeaderProps) {
  const Heading = headingLevel;

  return (
    <header
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}
      data-slot="page-header"
      {...props}
    >
      <div>
        <Heading className={headingLevel === "h1" ? "text-display" : "text-h2"}>
          {title}
        </Heading>
        {description ? (
          <p className="mt-2 max-w-2xl text-body-large text-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
