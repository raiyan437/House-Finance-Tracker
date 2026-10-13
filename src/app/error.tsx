"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StandalonePage } from "@/presentation/shell/standalone-page";

export default function RootError({ reset }: { reset: () => void }) {
  return <StandalonePage icon={CircleAlert} title="Something went wrong" description="The page could not be displayed. Please try again." action={<Button onClick={reset}>Try again</Button>} />;
}
