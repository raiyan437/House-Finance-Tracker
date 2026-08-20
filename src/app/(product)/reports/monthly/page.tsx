import { Suspense } from "react";
import { LoadingState } from "@/presentation/components/async-state";
import { PageContainer } from "@/presentation/shell/page-container";
import { MonthlyReportPageClient } from "@/presentation/analytics/monthly-report-page.client";

export default function MonthlyReportPage() {
  return (
    <Suspense fallback={<PageContainer><LoadingState label="Loading Monthly Report" /></PageContainer>}>
      <MonthlyReportPageClient />
    </Suspense>
  );
}
