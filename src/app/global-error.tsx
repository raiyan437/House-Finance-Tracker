"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StandalonePage } from "@/presentation/shell/standalone-page";
import "./globals.css";

export default function GlobalError({ reset }: { reset: () => void }) {
  return <html lang="en"><body style={{ fontFamily: "Arial, sans-serif" }}><title>Something went wrong · House Finance Tracker</title><StandalonePage icon={CircleAlert} title="Something went wrong" description="The app could not be displayed. Please try again." action={<Button onClick={reset}>Try again</Button>} /></body></html>;
}
