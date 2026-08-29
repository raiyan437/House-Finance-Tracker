import { Suspense } from "react";
import { AuthShell } from "../auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" description="For security, all other sessions are invalidated and you must sign in again.">
      <Suspense fallback={null}><ResetPasswordForm /></Suspense>
    </AuthShell>
  );
}
