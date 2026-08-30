import Link from "next/link";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: Readonly<{ searchParams: Promise<{ passwordUpdated?: string }> }>) {
  const passwordUpdated = (await searchParams).passwordUpdated === "1";
  return (
    <AuthShell title="Sign In" description="Access your household finance tracker.">
      {passwordUpdated ? <p className="mb-4 rounded-xl bg-success-soft px-4 py-3 text-sm text-success" role="status">Password updated successfully. Sign in with your new password.</p> : null}
      <LoginForm />
      <div className="mt-4 grid gap-2 text-center text-caption text-text-secondary sm:grid-cols-2 sm:text-left">
        <Link href="/forgot-password" className="underline underline-offset-4">Forgot password?</Link>
        <span className="sm:text-right">Don&apos;t have an account? <Link href="/signup" className="underline underline-offset-4">Sign up</Link></span>
      </div>
    </AuthShell>
  );
}
