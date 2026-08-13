import { LoadingState } from "@/presentation/components/async-state";
import { PageContainer } from "@/presentation/shell/page-container";

export default function ProductLoading() {
  return (
    <PageContainer>
      <LoadingState label="Loading page" />
    </PageContainer>
  );
}
