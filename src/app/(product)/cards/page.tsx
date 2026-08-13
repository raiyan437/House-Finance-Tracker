import { CreditCard } from "lucide-react";
import { FeaturePlaceholder } from "@/presentation/shell/feature-placeholder";

export default function CardsPage() {
  return (
    <FeaturePlaceholder
      description="Private card management is intentionally reserved for its approved feature phase."
      icon={CreditCard}
      title="Cards"
    />
  );
}
