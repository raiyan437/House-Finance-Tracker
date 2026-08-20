import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/presentation/components/async-state";
import { PageContainer } from "./page-container";

interface FeaturePlaceholderProps {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly hideVisiblePageTitle?: boolean;
}

export function FeaturePlaceholder({
  title,
  description,
  icon,
  hideVisiblePageTitle = false,
}: FeaturePlaceholderProps) {
  return (
    <PageContainer className="grid gap-6">
      <h1 className={hideVisiblePageTitle ? "sr-only" : "page-title"}>{title}</h1>
      <EmptyState description={description} icon={icon} title={`${title} foundation ready`} />
    </PageContainer>
  );
}
