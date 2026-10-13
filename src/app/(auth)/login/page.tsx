import Link from "next/link";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: Promise<{ passwordUpdated?: string; sessionExpired?: string }> }>) {
  const params = await searchParams;
  const passwordUpdated = params.passwordUpdated === "1";
  return (
    <AuthShell title="Sign In" description="Access your household finance tracker.">
      {passwordUpdated ? <p className="mb-4 rounded-xl bg-success-soft px-4 py-3 text-sm text-success" role="status">Password updated successfully. Sign in with your new password.</p> : null}
      {params.sessionExpired === "1" ? <p className="mb-4 rounded-xl bg-secondary px-4 py-3 text-sm" role="status">Your session has expired. Please sign in again.</p> : null}
      <LoginForm />
      <div className="journey-auth-links mt-6 grid gap-5 text-center text-sm text-text-secondary">
        <Link href="/forgot-password" className="underline underline-offset-4">Forgot password?</Link>
        <span className="border-t pt-6">Don&apos;t have an account? <Link href="/signup" className="font-semibold underline underline-offset-4">Sign up</Link></span>
      </div>
    </AuthShell>
  );
}
