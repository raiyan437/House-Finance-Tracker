import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StandalonePage } from "@/presentation/shell/standalone-page";

export default function NotFound() {
  return <StandalonePage code="404" title="Page not found" description="This page could not be found. Return to your dashboard to continue." action={<Button asChild><Link href="/dashboard" prefetch={false}>Back to Dashboard</Link></Button>} />;
}
