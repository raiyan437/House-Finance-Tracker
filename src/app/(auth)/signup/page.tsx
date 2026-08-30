import Link from "next/link";
import { AuthShell } from "../auth-shell";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <AuthShell title="Create Account" description="Create your approved household account.">
      <SignupForm />
      <p className="mt-4 text-center text-caption text-text-secondary">
        Already have an account? <Link href="/login" className="underline underline-offset-4">Sign in</Link>
      </p>
    </AuthShell>
  );
}
