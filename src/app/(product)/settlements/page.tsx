import { HandCoins } from "lucide-react";
import { FeaturePlaceholder } from "@/presentation/shell/feature-placeholder";

export default function SettlementsPage() {
  return (
    <FeaturePlaceholder
      description="Settlement recommendations and claim actions are reserved for the Settlements feature phase."
      icon={HandCoins}
      title="Settlements"
    />
  );
}
