import { Suspense } from "react";
import { ExpensesPageClient } from "@/presentation/expenses/expenses-page.client";
import { LoadingState } from "@/presentation/components/async-state";
import { PageContainer } from "@/presentation/shell/page-container";

export default function ExpensesPage() {
  return <Suspense fallback={<PageContainer><LoadingState label="Loading expenses" /></PageContainer>}><ExpensesPageClient /></Suspense>;
}
