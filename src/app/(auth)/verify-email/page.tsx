import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "../auth-shell";
import { VerifyEmailActions } from "./verify-email-actions";

export const metadata: Metadata = { referrer: "no-referrer", robots: { index: false, follow: false } };

export default function VerifyEmailPage() {
  return (
    <AuthShell title="Verify your email" description="Open the link from your inbox in the browser where you signed in.">
      <Suspense fallback={null}><VerifyEmailActions /></Suspense>
    </AuthShell>
  );
}
