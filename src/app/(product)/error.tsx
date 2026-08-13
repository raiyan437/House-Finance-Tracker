"use client";

import { ErrorState } from "@/presentation/components/async-state";
import { PageContainer } from "@/presentation/shell/page-container";

export default function ProductError({ reset }: { reset: () => void }) {
  return (
    <PageContainer>
      <ErrorState
        description="The page could not be displayed. Your local data has not been reset."
        onRetry={reset}
        title="Something went wrong"
      />
    </PageContainer>
  );
}
