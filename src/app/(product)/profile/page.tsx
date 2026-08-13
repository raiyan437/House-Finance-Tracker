import { UserRound } from "lucide-react";
import { FeaturePlaceholder } from "@/presentation/shell/feature-placeholder";

export default function ProfilePage() {
  return (
    <FeaturePlaceholder
      description="The profile destination is connected for shell validation. Profile behavior is introduced later."
      icon={UserRound}
      title="Profile"
    />
  );
}
