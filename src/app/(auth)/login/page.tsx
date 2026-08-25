import Link from "next/link";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell title="Sign In" description="Access your household finance tracker.">
      <LoginForm />
      <div className="mt-4 flex justify-between text-caption text-text-secondary">
        <Link href="/forgot-password" className="underline underline-offset-4">Forgot password?</Link>
        <Link href="/register" className="underline underline-offset-4">Account access</Link>
      </div>
    </AuthShell>
  );
}
