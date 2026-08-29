import { AuthShell } from "../auth-shell";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Forgot password" description="We will email you a recovery link valid for one hour.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
