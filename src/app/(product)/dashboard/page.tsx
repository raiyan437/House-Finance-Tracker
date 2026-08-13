import { LayoutDashboard } from "lucide-react";
import { FeaturePlaceholder } from "@/presentation/shell/feature-placeholder";

export default function DashboardPage() {
  return (
    <FeaturePlaceholder
      description="The application shell is ready. Dashboard data and analytics are introduced in their approved feature phase."
      hideVisiblePageTitle
      icon={LayoutDashboard}
      title="Dashboard"
    />
  );
}
