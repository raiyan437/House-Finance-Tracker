import { AuthShell } from "../auth-shell";
import Link from "next/link";

export default function RegisterPage() {
  return (
    <AuthShell title="Accounts are provided by the administrator" description="This household application does not support public sign-up.">
      <p className="text-body text-text-secondary">
        If you are an approved household member and have not signed in before, use the Forgot Password flow on the sign-in page with your approved
        email address to set your password.
      </p>
      <div className="mt-6 text-center">
        <Link href="/login" className="inline-flex h-11 items-center rounded-xl bg-foreground px-4 text-sm font-semibold text-white">Sign In</Link>
      </div>
    </AuthShell>
  );
}
